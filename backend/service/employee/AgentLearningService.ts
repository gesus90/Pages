import { TOOL_USE_RETENTION_DAYS } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AGENT_DREAM_NO_COUNTS } from "@/definition/AgentDreaming";
import { AGENT_DREAM_DEFAULT_TIME } from "@/definition/AgentMemory";

import { digestToolUses } from "./AgentDreamEvidence";
import {
  mergeDreamLessons,
  parseDreamDocument,
  renderDreamDocument,
} from "./AgentDreamDocument";
import { takeIntoMemory } from "./AgentDreamMemory";
import { curateRecipes } from "./AgentDreamRecipes";
import { isDreamDue } from "./AgentDreamSchedule";
import { databaseTimeToIso, toDatabaseTime } from "./AgentEmployeeText";
import { parseMemoryDocument } from "./AgentMemoryDocument";
import { logbookKindName } from "./AgentLogbookInput";
import { logbookChatLabel } from "./AgentLogbookService";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { StoredAgentDreaming } from "@/backend/database/repositories/employee/AgentDreamingRepository";
import type { StoredAgentRecipe } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { StoredAgentLogbookEntry } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type { AgentLearningSource } from "@/backend/database/repositories/employee/AgentLearningSourceRepository";
import type { StoredAgentToolUse } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AgentLearningResult } from "@/definition/AgentEmployee";
import type {
  AgentDreamCounts,
  AgentDreamLogEntry,
  AgentDreamTrigger,
} from "@/definition/AgentDreaming";
import type { User } from "@/definition/User";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentDreamAnswer, AgentDreamInput } from "./AgentLearningPrompt";
import type { AgentMemoryModel } from "./AgentMemoryModel";
import type { AgentMemoryService } from "./AgentMemoryService";

const COMPONENT = "AgentLearningService";

/** Source entries per kind one run reads at most. */
const SOURCE_LIMIT = 80;
/** Entries of the Lagebuch one run condenses at most. */
const LOGBOOK_LIMIT = 80;
/** Tool calls one run reads at most. */
const TOOL_USE_LIMIT = 400;

/** What dream runs use. */
export interface AgentLearningDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly memory: Pick<AgentMemoryService, "saveDream" | "updateMemory">;
  /** The model call of the dream run; the simulation replaces it. */
  readonly model: AgentMemoryModel;
  readonly activity: AgentActivityService;
  /**
   * Whether the agent works in a chat now. A run starts only while it does
   * not (PAGE-378) and otherwise waits for the next quiet moment.
   */
  readonly isWorkingInChat?: (agentId: string) => boolean;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** What one run read; the run starts a model only when some of it is new. */
interface AgentDreamReading {
  readonly sources: readonly AgentLearningSource[];
  readonly logbook: readonly StoredAgentLogbookEntry[];
  readonly uses: readonly StoredAgentToolUse[];
  readonly recipes: readonly StoredAgentRecipe[];
}

/** What a run settles: the result, the log and how far it read. */
interface AgentDreamSettlement {
  readonly trigger: AgentDreamTrigger;
  readonly result: AgentLearningResult;
  readonly log: readonly AgentDreamLogEntry[];
  /** The newest source time read; `null` keeps the old position. */
  readonly learnedThrough: string | null;
  readonly logbookThrough: number | null;
  readonly toolsThrough: number | null;
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

function countLog(log: readonly AgentDreamLogEntry[]): AgentDreamCounts {
  const counts = { ...AGENT_DREAM_NO_COUNTS };
  for (const entry of log) counts[entry.kind] += 1;
  return counts;
}

function lessonLog(
  merged: ReturnType<typeof mergeDreamLessons>,
): AgentDreamLogEntry[] {
  return [
    ...merged.addedTexts.map((text) => ({
      kind: "lessonLearned" as const,
      text,
    })),
    ...merged.mergedTexts.map((text) => ({
      kind: "lessonStrengthened" as const,
      text,
    })),
    ...merged.removedTexts.map((text) => ({
      kind: "lessonDropped" as const,
      text,
    })),
  ];
}

/**
 * The dream runs of agent employees (PAGE-305, PAGE-378).
 *
 * @remarks
 * A run reads what is new since the last one: the entries of the Lagebuch,
 * the tool calls of the chat sessions and the chats, projects, groups and
 * plan runs of the agent; confidential chats are left out of all of it.
 * Without anything new no model runs. Otherwise one model call answers three
 * things: the durable points of the Lagebuch for `MEMORY.md`, lessons about
 * how the agent works for `DREAM.md` (confirmed ones grow stronger, the
 * weakest fall out when the file is full) and recipes, shortcuts the agent
 * can use at once. Everything takes effect without approval. A run starts only
 * while the agent works in no chat and otherwise waits for the next quiet
 * moment. Every applied run records a version and its log.
 */
export class AgentLearningService {
  private readonly dependencies: AgentLearningDependencies;
  private readonly running = new Set<string>();

  public constructor(dependencies: AgentLearningDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the dream run of the agent is due now: its schedule has come or somebody asked for a run. */
  public async isDue(agent: StoredAgentEmployee): Promise<boolean> {
    return isDreamDue(agent, this.now(), await this.dreamTime());
  }

  /** Whether a run of the agent is going on now. */
  public isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }

  /**
   * Starts a run somebody asked for in the background.
   *
   * @param agentId - The agent that dreams.
   * @param trigger - Who asked: a person, or a Lagebuch that is full.
   * @returns `started`, or `waiting` while the agent works in a chat, when the
   * run follows at the next quiet moment.
   */
  public async request(
    agentId: string,
    trigger: Exclude<AgentDreamTrigger, "schedule">,
  ): Promise<"started" | "waiting"> {
    if (this.isBusy(agentId)) {
      await this.defer(agentId, trigger);
      return "waiting";
    }
    void this.run(agentId, { trigger }).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
    return "started";
  }

  /**
   * Runs one dream run of an agent, whatever its schedule.
   *
   * @param agentId - The agent that dreams.
   * @param options - What started the run; a scheduled run by default.
   * @returns The result, or `null` when the agent cannot dream now: inactive,
   * already dreaming, or working in a chat, in which case the run waits.
   */
  public async run(
    agentId: string,
    options: { readonly trigger?: AgentDreamTrigger } = {},
  ): Promise<AgentLearningResult | null> {
    if (this.running.has(agentId)) return null;
    this.running.add(agentId);
    try {
      return await this.dream(agentId, options.trigger ?? "schedule");
    } finally {
      this.running.delete(agentId);
    }
  }

  private isBusy(agentId: string): boolean {
    return this.dependencies.isWorkingInChat?.(agentId) ?? false;
  }

  /** A run somebody asked for waits for the next quiet moment; a scheduled one is still due then. */
  private async defer(
    agentId: string,
    trigger: AgentDreamTrigger,
  ): Promise<void> {
    if (trigger === "schedule") return;
    await this.dependencies.store
      .dreaming()
      .saveRequest(agentId, { at: toDatabaseTime(this.now()), trigger });
  }

  private async dream(
    agentId: string,
    trigger: AgentDreamTrigger,
  ): Promise<AgentLearningResult | null> {
    const { store, users } = this.dependencies;
    const [agent, employee, dreaming] = await Promise.all([
      users.findById(agentId),
      store.employees().find(agentId),
      store.dreaming().find(agentId),
    ]);
    if (agent?.isAgent !== true || !agent.isActive || !employee || !dreaming)
      return null;
    if (this.isBusy(agentId)) {
      await this.defer(agentId, trigger);
      return null;
    }
    const reading = await this.read(agentId, employee, dreaming);
    const base = { trigger, logbookThrough: null, toolsThrough: null };
    // Nothing new: the run ends here, and no model is asked.
    if (!this.hasNews(reading))
      return this.finish(agentId, {
        ...base,
        result: result("unchanged"),
        log: [],
        learnedThrough: null,
      });
    try {
      return await this.apply({ agent, employee, dreaming }, reading, trigger);
    } catch (error: unknown) {
      if (error instanceof AgentEmployeeError) {
        if (error.code === "busy") return null;
        return this.failed(agentId, trigger, error.code);
      }
      logCaughtError(COMPONENT, error);
      return this.failed(agentId, trigger, "failed");
    }
  }

  private async read(
    agentId: string,
    employee: StoredAgentEmployee,
    dreaming: StoredAgentDreaming,
  ): Promise<AgentDreamReading> {
    const { store } = this.dependencies;
    const [sources, logbook, uses, recipes] = await Promise.all([
      store
        .sources()
        .read(agentId, { since: employee.learnedThrough, limit: SOURCE_LIMIT }),
      store
        .logbook()
        .forDreaming(agentId, {
          after: dreaming.logbookThrough,
          limit: LOGBOOK_LIMIT,
        }),
      store.toolUses().since(agentId, dreaming.toolsThrough, TOOL_USE_LIMIT),
      store.recipes().list(agentId),
    ]);
    return { sources, logbook, uses, recipes };
  }

  /** Whether there is anything new, or a recipe that failed and wants a correction. */
  private hasNews(reading: AgentDreamReading): boolean {
    return (
      reading.sources.length > 0 ||
      reading.logbook.length > 0 ||
      reading.uses.length > 0 ||
      reading.recipes.some((recipe) => recipe.disabledReason === "failed")
    );
  }

  private async apply(
    subject: {
      readonly agent: User;
      readonly employee: StoredAgentEmployee;
      readonly dreaming: StoredAgentDreaming;
    },
    reading: AgentDreamReading,
    trigger: AgentDreamTrigger,
  ): Promise<AgentLearningResult> {
    const { agent, employee, dreaming } = subject;
    const today = this.now().toISOString().slice(0, 10);
    const answer = await this.dependencies.model.dream(
      { agent, employee, ...(dreaming.model ? { model: dreaming.model } : {}) },
      this.input(employee, { reading, today }),
    );
    if (answer === null) return this.failed(agent.id, trigger, "invalidAnswer");
    const memory = await takeIntoMemory(this.dependencies.memory, {
      agentId: agent.id,
      answer,
      logbook: reading.logbook,
      today,
    });
    const lessons = await this.learn(employee, answer, today);
    const recipes = await curateRecipes({
      store: this.dependencies.store,
      agentId: agent.id,
      answer,
      today,
      now: this.now(),
      ...(this.dependencies.createId
        ? { createId: this.dependencies.createId }
        : {}),
    });
    const log = [...memory.log, ...lessons.log, ...recipes];
    const counts = countLog(log);
    const outcome = result(log.length > 0 ? "updated" : "unchanged", {
      added: counts.lessonLearned,
      merged: counts.lessonStrengthened,
      archived: memory.archived,
      removed: counts.lessonDropped,
    });
    await this.dependencies.store
      .toolUses()
      .prune(
        agent.id,
        toDatabaseTime(
          new Date(this.now().getTime() - TOOL_USE_RETENTION_DAYS * 24 * 3_600_000),
        ),
      );
    return this.finish(agent.id, {
      trigger,
      result: outcome,
      log,
      learnedThrough: reading.sources.at(-1)?.at ?? null,
      logbookThrough: reading.logbook.at(-1)?.sequence ?? null,
      toolsThrough: reading.uses.at(-1)?.id ?? null,
    });
  }

  /** What the model reads: the memory, the lessons, the recipes and everything that is new. */
  private input(
    employee: StoredAgentEmployee,
    context: { readonly reading: AgentDreamReading; readonly today: string },
  ): AgentDreamInput {
    return {
      dream: employee.dream,
      topics: parseMemoryDocument(employee.memory).entries.map(
        ({ title, text }) => ({ title, text }),
      ),
      sources: context.reading.sources,
      logbook: context.reading.logbook.map((entry) => ({
        kind: logbookKindName(entry.kind),
        text: entry.text,
        chat: logbookChatLabel(entry.source),
        at: entry.createdAt,
      })),
      toolUse: digestToolUses(context.reading.uses),
      recipes: context.reading.recipes.map((recipe) => ({
        name: recipe.name,
        kind: recipe.kind,
        summary: recipe.summary,
        strength: recipe.strength,
        useCount: recipe.useCount,
        tools: recipe.steps.map((step) => step.tool),
        disabled: recipe.isActive
          ? null
          : {
              reason: recipe.disabledReason ?? "manual",
              error: recipe.lastError,
            },
      })),
      today: context.today,
    };
  }

  /** Merges the lessons of the run into `DREAM.md`, within its limit. */
  private async learn(
    employee: StoredAgentEmployee,
    answer: AgentDreamAnswer,
    today: string,
  ): Promise<{ readonly log: readonly AgentDreamLogEntry[] }> {
    if (answer.lessons.length === 0) return { log: [] };
    const merged = mergeDreamLessons(
      parseDreamDocument(employee.dream, today),
      answer.lessons.map((lesson) => ({
        ...lesson,
        strength: 1,
        isActive: true,
      })),
      employee.dreamCharacters,
    );
    const dream = renderDreamDocument(merged.lessons);
    if (dream !== employee.dream)
      await this.dependencies.memory.saveDream(employee.userId, dream);
    return { log: lessonLog(merged) };
  }

  private failed(
    agentId: string,
    trigger: AgentDreamTrigger,
    errorCode: string,
  ): Promise<AgentLearningResult> {
    return this.finish(agentId, {
      trigger,
      result: result("failed", { errorCode }),
      log: [],
      learnedThrough: null,
      logbookThrough: null,
      toolsThrough: null,
    });
  }

  private async finish(
    agentId: string,
    settlement: AgentDreamSettlement,
  ): Promise<AgentLearningResult> {
    const { store } = this.dependencies;
    const at = toDatabaseTime(this.now());
    await store.employees().saveLearning(agentId, {
      learnedThrough: settlement.learnedThrough,
      lastLearningAt: at,
      result: settlement.result,
    });
    await store.dreaming().saveRun(agentId, {
      run: {
        at: databaseTimeToIso(at) ?? at,
        status: settlement.result.status,
        trigger: settlement.trigger,
        errorCode: settlement.result.errorCode,
        counts: countLog(settlement.log),
        log: settlement.log,
      },
      logbookThrough: settlement.logbookThrough,
      toolsThrough: settlement.toolsThrough,
    });
    await this.dependencies.activity.recordLearning(agentId, settlement.result);
    logEvent({
      level: "info",
      event: "agent.dream.finished",
      component: COMPONENT,
      message: "Agent dream run finished",
      metadata: {
        status: settlement.result.status,
        trigger: settlement.trigger,
      },
    });
    return settlement.result;
  }

  private async dreamTime(): Promise<string> {
    try {
      return (await this.dependencies.store.sessionSettings().read()).dreamTime;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return AGENT_DREAM_DEFAULT_TIME;
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
