import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { nextLearningAt } from "./AgentEmployeeDirectory";
import { toDatabaseTime } from "./AgentEmployeeText";
import {
  createLearningMessage,
  readLearningAnswer,
} from "./AgentLearningPrompt";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AgentLearningResult } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeSessions } from "./AgentEmployeeSessions";
import type { AgentMemoryService } from "./AgentMemoryService";

/** Source entries per kind one run reads at most. */
const SOURCE_LIMIT = 80;
/** How often a waiting run looks at its job. */
const POLL_MILLISECONDS = 3_000;
/** How long a run waits for its job before it gives up. */
const RUN_TIMEOUT_MILLISECONDS = 30 * 60_000;

/** What learning runs use. */
export interface AgentLearningDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly sessions: Pick<AgentEmployeeSessions, "run" | "job">;
  readonly memory: AgentMemoryService;
  readonly activity: AgentActivityService;
  readonly now?: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
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

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/**
 * The learning runs of agent employees (PAGE-266).
 *
 * @remarks
 * A run reads what is new since the last one in the agent's groups,
 * projects, plan runs and own chats. Without anything new no model runs.
 * Otherwise the agent's own model condenses it in a session of the agent's
 * own account, and the result replaces `MEMORY.md` and changes the archive
 * within both word limits; every applied run records a version. A reached
 * cost limit refuses the run, and the reason is recorded.
 */
export class AgentLearningService {
  private readonly dependencies: AgentLearningDependencies;
  private readonly running = new Set<string>();

  public constructor(dependencies: AgentLearningDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether a run of the agent is due now. */
  public isDue(agent: StoredAgentEmployee): boolean {
    return (
      agent.isLearningEnabled &&
      nextLearningAt(agent).getTime() <= this.now().getTime()
    );
  }

  /**
   * Runs one learning run of an agent, whatever its rhythm.
   *
   * @returns The result, or `null` when the agent cannot learn now: inactive,
   * already learning or busy with another session.
   */
  public async run(agentId: string): Promise<AgentLearningResult | null> {
    if (this.running.has(agentId)) return null;
    this.running.add(agentId);
    try {
      return await this.learn(agentId);
    } finally {
      this.running.delete(agentId);
    }
  }

  private async learn(agentId: string): Promise<AgentLearningResult | null> {
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
      const answer = await this.ask(agent, employee, sources);
      if (answer === null) return null;
      return await this.apply(agentId, learnedThrough, answer);
    } catch (error: unknown) {
      if (error instanceof AgentEmployeeError) {
        if (error.code === "busy") return null;
        return this.finish(
          agentId,
          null,
          result(
            error.code === "costLimitReached" ? "limitReached" : "failed",
            {
              errorCode: error.code,
            },
          ),
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

  /** Starts the run's job and waits for its answer; `null` when no job started. */
  private async ask(
    agent: User,
    employee: StoredAgentEmployee,
    sources: Parameters<typeof createLearningMessage>[2],
  ): Promise<string | null> {
    const archive = await this.dependencies.store.memory().archive(agent.id);
    const started = await this.dependencies.sessions.run({
      agent,
      employee,
      person: null,
      purpose: "learning",
      text: createLearningMessage(employee.memory, archive, sources),
      clientMessageId: null,
    });
    if (!started) return null;
    const { start, sessionId } = started;
    const deadline = this.now().getTime() + RUN_TIMEOUT_MILLISECONDS;
    for (;;) {
      const job = await this.dependencies.sessions.job(
        agent,
        sessionId,
        start.job.id,
      );
      if (job && job.state !== "running") {
        if (job.state !== "completed")
          throw new AgentEmployeeError("unavailable");
        break;
      }
      if (this.now().getTime() > deadline)
        throw new AgentEmployeeError("unavailable");
      await (this.dependencies.wait ?? defaultWait)(POLL_MILLISECONDS);
    }
    const messages = await this.dependencies.messages.messages(sessionId);
    const answer = messages.at(-1);
    return answer?.role === "assistant" ? answer.content : "";
  }

  private async apply(
    agentId: string,
    learnedThrough: string | null,
    answer: string,
  ): Promise<AgentLearningResult> {
    const update = readLearningAnswer(answer);
    if (!update)
      return this.finish(
        agentId,
        null,
        result("failed", { errorCode: "invalidAnswer" }),
      );
    const trimmed = await this.dependencies.memory.applyLearning(
      agentId,
      update,
    );
    return this.finish(
      agentId,
      learnedThrough,
      result("updated", {
        added: update.added,
        merged: update.merged,
        archived: update.archiveAdd.length,
        removed: update.removed + update.archiveRemove.length + trimmed,
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
      event: "agent.learning.finished",
      component: "AgentLearningService",
      message: "Agent learning run finished",
      metadata: { status: outcome.status },
    });
    return outcome;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
