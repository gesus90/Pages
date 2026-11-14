import { z } from "zod";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  AGENT_DREAM_INTERVAL_UNITS,
  AGENT_DREAM_NO_COUNTS,
  AGENT_DREAM_WEEKLY_DAYS,
} from "@/definition/AgentDreaming";
import { AGENT_LOGBOOK_COMPACTION_PERCENT } from "@/definition/AgentLogbook";
import {
  AGENT_DREAM_DEFAULT_TIME,
  AGENT_DREAM_TIME_PATTERN,
  countCharacters,
} from "@/definition/AgentMemory";

import { parseDreamDocument } from "./AgentDreamDocument";
import {
  isDreamDue,
  isValidDreamSchedule,
  nextDreamRun,
} from "./AgentDreamSchedule";
import { databaseTimeToIso } from "./AgentEmployeeText";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type {
  StoredAgentDreaming,
  StoredDreamRun,
} from "@/backend/database/repositories/employee/AgentDreamingRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AgentDreamModelChoice,
  AgentDreamRunView,
  AgentDreamSchedule,
  AgentDreamingOverview,
} from "@/definition/AgentDreaming";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";
import type { AgentChatSessionViewer } from "./AgentChatSessionService";
import type { AgentLearningService } from "./AgentLearningService";

/** What the tab "Dreaming" is read and changed with. */
export interface AgentDreamingAdministrationDependencies {
  readonly store: Pick<
    EmployeeStore,
    "employees" | "dreaming" | "logbook" | "sessionSettings"
  >;
  readonly users: Pick<UserRepository, "findById">;
  /** Runs and requests the dream run; `null` where no model can run one. */
  readonly learning: Pick<AgentLearningService, "request" | "isRunning"> | null;
  /** Whether the agent works in a chat now. */
  readonly isWorkingInChat: (agentId: string) => boolean;
  /** The models an administrator may give an agent. */
  readonly models: (userId: string) => Promise<readonly PageAgentModel[]>;
  readonly now?: () => Date;
}

/** An empty form field counts as absent. */
const optionalText = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().min(1).max(300).nullable(),
);

const optionalNumber = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.number().int().nullable(),
);

const booleanText = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

const settingsInput = z
  .object({
    enabled: booleanText,
    interval: z.coerce.number().int(),
    unit: z.enum(AGENT_DREAM_INTERVAL_UNITS),
    time: z.preprocess(
      (value) => (value === "" ? null : value),
      z.string().regex(AGENT_DREAM_TIME_PATTERN).nullable(),
    ),
    weekday: optionalNumber,
    onFullLogbook: booleanText,
    modelConnectionId: optionalText,
    model: optionalText,
  })
  .refine(
    (input) => (input.modelConnectionId === null) === (input.model === null),
  );

function choiceOf(model: PageAgentModel): AgentDreamModelChoice[] {
  return model.connectionId === undefined
    ? []
    : [
        {
          connectionId: model.connectionId,
          model: model.model,
          label: model.name,
        },
      ];
}

/**
 * The schedule a form describes, brought into the shape the dream run accepts:
 * hours carry no time of day and no weekday, a weekday belongs to an interval of
 * 7 days only.
 */
function normalizedSchedule(
  input: z.infer<typeof settingsInput>,
): AgentDreamSchedule {
  const isDays = input.unit === "days";
  const isWeekly = isDays && input.interval === AGENT_DREAM_WEEKLY_DAYS;
  return {
    isEnabled: input.enabled,
    interval: input.interval,
    unit: input.unit,
    time: isDays ? input.time : null,
    weekday: isWeekly ? input.weekday : null,
    isOnFullLogbook: input.onFullLogbook,
  };
}

/** The log of a run a migrated agent has no record of: its stored result without a log. */
function legacyRun(employee: StoredAgentEmployee): StoredDreamRun | null {
  const stored = employee.lastLearningResult;
  const at = databaseTimeToIso(employee.lastLearningAt);
  if (!stored || at === null) return null;
  return {
    at,
    status: stored.status,
    trigger: null,
    errorCode: stored.errorCode,
    counts: {
      ...AGENT_DREAM_NO_COUNTS,
      lessonLearned: stored.added,
      lessonStrengthened: stored.merged,
      lessonDropped: stored.removed,
    },
    log: [],
  };
}

/**
 * The tab "Dreaming" of the agent settings (PAGE-378): the schedule of the
 * dream run, its last and next run with the log of the last, the sizes of
 * `MEMORY.md` and `DREAM.md`, and the button "Jetzt träumen".
 *
 * @remarks
 * Only an administrator reads the log and the two files, saves the schedule
 * or starts a run, because they hold what the agent learned from the chats of
 * its people. Everybody else sees the schedule and when the agent dreams.
 */
export class AgentDreamingAdministration {
  private readonly dependencies: AgentDreamingAdministrationDependencies;

  public constructor(dependencies: AgentDreamingAdministrationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the Dreaming of an agent as the viewer may see it.
   *
   * @throws {AgentEmployeeError} `notFound` for an account that is no agent.
   */
  public async overview(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<AgentDreamingOverview> {
    const agent = await this.requireAgent(agentId);
    const { store } = this.dependencies;
    const [employee, dreaming, settings, logbook, models] = await Promise.all([
      store.employees().find(agentId),
      store.dreaming().find(agentId),
      store.sessionSettings().read(),
      this.logbookFill(agentId),
      viewer.isAdministrator
        ? this.dependencies.models(viewer.user.id)
        : Promise.resolve([]),
    ]);
    if (!employee || !dreaming) throw new AgentEmployeeError("notFound");
    const choices = models.flatMap(choiceOf);
    return this.describe({
      viewer,
      agent,
      employee,
      dreaming,
      instanceTime: settings.dreamTime,
      logbook,
      choices,
    });
  }

  /**
   * Saves the schedule and the model of an agent.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `invalidInput` for a schedule outside its ranges or a
   * model the administrator may not choose, `notFound` for an account that is
   * no agent.
   */
  public async saveSettings(
    viewer: AgentChatSessionViewer,
    agentId: string,
    input: unknown,
  ): Promise<void> {
    if (!viewer.isAdministrator) throw new AgentEmployeeError("forbidden");
    await this.requireAgent(agentId);
    const parsed = settingsInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const schedule = normalizedSchedule(parsed.data);
    if (!isValidDreamSchedule(schedule))
      throw new AgentEmployeeError("invalidInput");
    const { modelConnectionId, model } = parsed.data;
    const chosen =
      modelConnectionId !== null && model !== null
        ? { connectionId: modelConnectionId, model }
        : null;
    if (chosen !== null && !(await this.isAllowed(viewer.user.id, chosen)))
      throw new AgentEmployeeError("invalidInput");
    const isSaved = await this.dependencies.store
      .dreaming()
      .saveSchedule(agentId, { schedule, model: chosen });
    if (!isSaved) throw new AgentEmployeeError("notFound");
  }

  /**
   * Starts a dream run now ("Jetzt träumen"); while the agent works in a chat
   * the run waits for the next quiet moment.
   *
   * @returns `started`, or `waiting`.
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `unavailable` where no model can run a dream, `inactive`
   * for a deactivated agent, `notFound` for an account that is no agent.
   */
  public async runNow(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<"started" | "waiting"> {
    if (!viewer.isAdministrator) throw new AgentEmployeeError("forbidden");
    const agent = await this.requireAgent(agentId);
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    const { learning } = this.dependencies;
    if (!learning) throw new AgentEmployeeError("unavailable");
    return learning.request(agentId, "manual");
  }

  private async describe(parts: {
    readonly viewer: AgentChatSessionViewer;
    readonly agent: User;
    readonly employee: StoredAgentEmployee;
    readonly dreaming: StoredAgentDreaming;
    readonly instanceTime: string;
    readonly logbook: { readonly count: number; readonly fillPercent: number };
    readonly choices: readonly AgentDreamModelChoice[];
  }): Promise<AgentDreamingOverview> {
    const { viewer, agent, employee, dreaming } = parts;
    const now = this.now();
    const instanceTime = parts.instanceTime || AGENT_DREAM_DEFAULT_TIME;
    const isRunning = this.dependencies.learning?.isRunning(agent.id) ?? false;
    const isDue = isDreamDue(employee, now, instanceTime);
    const run = dreaming.lastRun ?? legacyRun(employee);
    return {
      agentId: agent.id,
      agentName: agent.displayName,
      schedule: employee.dreamSchedule,
      instanceTime,
      model: dreaming.model,
      ownModelLabel:
        parts.choices.find(
          (choice) =>
            choice.connectionId === employee.connectionId &&
            choice.model === employee.model,
        )?.label ?? employee.model,
      models: parts.choices,
      nextRunAt: nextDreamRun(employee, instanceTime)?.toISOString() ?? null,
      isRunning,
      isWaiting:
        isDue && !isRunning && this.dependencies.isWorkingInChat(agent.id),
      lastRun: run ? this.runView(run, viewer.isAdministrator) : null,
      memory: {
        characters: countCharacters(employee.memory),
        limit: employee.memoryCharacters,
      },
      dream: {
        characters: countCharacters(employee.dream),
        limit: employee.dreamCharacters,
        lessons: parseDreamDocument(employee.dream, "").length,
      },
      logbook: {
        ...parts.logbook,
        triggerPercent: AGENT_LOGBOOK_COMPACTION_PERCENT,
      },
      files: viewer.isAdministrator
        ? { memory: employee.memory, dream: employee.dream }
        : null,
      canChange: viewer.isAdministrator,
    };
  }

  /** The log of a run is for an administrator only. */
  private runView(run: StoredDreamRun, mayReadLog: boolean): AgentDreamRunView {
    return { ...run, log: mayReadLog ? run.log : [] };
  }

  private async logbookFill(
    agentId: string,
  ): Promise<{ readonly count: number; readonly fillPercent: number }> {
    const logbook = this.dependencies.store.logbook();
    const [settings, count] = await Promise.all([
      logbook.settings(agentId),
      logbook.count(agentId),
    ]);
    return {
      count,
      fillPercent: settings
        ? Math.min(100, Math.round((count / settings.limit) * 100))
        : 0,
    };
  }

  private async isAllowed(
    administratorId: string,
    chosen: { readonly connectionId: string; readonly model: string },
  ): Promise<boolean> {
    const models = await this.dependencies.models(administratorId);
    return models.some(
      (model) =>
        model.connectionId === chosen.connectionId &&
        model.model === chosen.model,
    );
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    return agent;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
