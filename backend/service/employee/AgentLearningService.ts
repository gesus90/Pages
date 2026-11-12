import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AGENT_DREAM_DEFAULT_TIME } from "@/definition/AgentMemory";

import {
  mergeDreamLessons,
  parseDreamDocument,
  renderDreamDocument,
} from "./AgentDreamDocument";
import { isDreamDue } from "./AgentDreamSchedule";
import { toDatabaseTime } from "./AgentEmployeeText";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentLearningSource } from "@/backend/database/repositories/employee/AgentLearningSourceRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AgentLearningResult } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentMemoryModel } from "./AgentMemoryModel";
import type { AgentMemoryService } from "./AgentMemoryService";

/** Source entries per kind one run reads at most. */
const SOURCE_LIMIT = 80;

/** What dream runs use. */
export interface AgentLearningDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly memory: Pick<AgentMemoryService, "saveDream">;
  /** The model call of the dream run; the simulation replaces it. */
  readonly model: AgentMemoryModel;
  readonly activity: AgentActivityService;
  readonly now?: () => Date;
}

function result(
  status: AgentLearningResult["status"],
  counts: Partial<Omit<AgentLearningResult, "status">> = {},
): AgentLearningResult {
  return {
    status,
    added: counts.added ?? 0,
    merged: counts.merged ?? 0,
    archived: counts.archived ?? 0,
    removed: counts.removed ?? 0,
    errorCode: counts.errorCode ?? null,
  };
}

/**
 * The nightly dream runs of agent employees (PAGE-305), which replace the
 * learning runs of PAGE-266.
 *
 * @remarks
 * A run reads what is new since the last one in the agent's chats and
 * conversations, projects, groups and plan runs, with errors and feedback
 * among them; confidential chats are left out. Without anything new no
 * model runs. Otherwise the model derives lessons with evidence and date,
 * Pages merges them with similar ones in `DREAM.md` and drops the weakest,
 * then oldest lesson until the file keeps its character limit; every
 * applied run records a version. `MEMORY.md` is kept current after each
 * answer and is not touched here.
 */
export class AgentLearningService {
  private readonly dependencies: AgentLearningDependencies;
  private readonly running = new Set<string>();

  public constructor(dependencies: AgentLearningDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the dream run of the agent is due now. */
  public async isDue(agent: StoredAgentEmployee): Promise<boolean> {
    return isDreamDue(agent, this.now(), await this.dreamTime());
  }

  /**
   * Runs one dream run of an agent, whatever its time.
   *
   * @returns The result, or `null` when the agent cannot dream now: inactive,
   * already dreaming or busy with another session.
   */
  public async run(agentId: string): Promise<AgentLearningResult | null> {
    if (this.running.has(agentId)) return null;
    this.running.add(agentId);
    try {
      return await this.dream(agentId);
    } finally {
      this.running.delete(agentId);
    }
  }

  private async dream(agentId: string): Promise<AgentLearningResult | null> {
    const [agent, employee] = await Promise.all([
      this.dependencies.users.findById(agentId),
      this.dependencies.store.employees().find(agentId),
    ]);
    if (agent?.isAgent !== true || !agent.isActive || !employee) return null;
    const sources = await this.dependencies.store
      .sources()
      .read(agentId, { since: employee.learnedThrough, limit: SOURCE_LIMIT });
    // Nothing new: the run ends here, and no model is asked.
    if (sources.length === 0)
      return this.finish(agentId, null, result("unchanged"));
    const learnedThrough = sources.at(-1)?.at ?? null;
    try {
      return await this.apply(agent, employee, { sources, learnedThrough });
    } catch (error: unknown) {
      if (error instanceof AgentEmployeeError) {
        if (error.code === "busy") return null;
        return this.finish(
          agentId,
          null,
          result("failed", { errorCode: error.code }),
        );
      }
      logCaughtError("AgentLearningService", error);
      return this.finish(
        agentId,
        null,
        result("failed", { errorCode: "failed" }),
      );
    }
  }

  private async apply(
    agent: User,
    employee: StoredAgentEmployee,
    input: {
      readonly sources: readonly AgentLearningSource[];
      readonly learnedThrough: string | null;
    },
  ): Promise<AgentLearningResult> {
    const today = this.now().toISOString().slice(0, 10);
    const lessons = await this.dependencies.model.dream(
      { agent, employee },
      { dream: employee.dream, sources: input.sources, today },
    );
    if (lessons === null)
      return this.finish(
        agent.id,
        null,
        result("failed", { errorCode: "invalidAnswer" }),
      );
    const merged = mergeDreamLessons(
      parseDreamDocument(employee.dream, today),
      lessons.map((lesson) => ({ ...lesson, strength: 1 })),
      employee.dreamCharacters,
    );
    const dream = renderDreamDocument(merged.lessons);
    if (dream !== employee.dream)
      await this.dependencies.memory.saveDream(agent.id, dream);
    return this.finish(
      agent.id,
      input.learnedThrough,
      result("updated", {
        added: Math.max(0, lessons.length - merged.merged),
        merged: merged.merged,
        removed: merged.removed,
      }),
    );
  }

  private async finish(
    agentId: string,
    learnedThrough: string | null,
    outcome: AgentLearningResult,
  ): Promise<AgentLearningResult> {
    await this.dependencies.store.employees().saveLearning(agentId, {
      learnedThrough,
      lastLearningAt: toDatabaseTime(this.now()),
      result: outcome,
    });
    await this.dependencies.activity.recordLearning(agentId, outcome);
    logEvent({
      level: "info",
      event: "agent.dream.finished",
      component: "AgentLearningService",
      message: "Agent dream run finished",
      metadata: { status: outcome.status },
    });
    return outcome;
  }

  private async dreamTime(): Promise<string> {
    try {
      return (await this.dependencies.store.sessionSettings().read()).dreamTime;
    } catch (error: unknown) {
      logCaughtError("AgentLearningService", error);
      return AGENT_DREAM_DEFAULT_TIME;
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
