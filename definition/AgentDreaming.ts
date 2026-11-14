/**
 * Contracts of Dreaming, lessons and recipes of an agent (PAGE-378).
 *
 * @remarks
 * Dreaming is the compaction run of an agent: it condenses the Lagebuch into
 * `MEMORY.md`, evaluates how the agent worked into lessons in `DREAM.md` and
 * creates recipes, shortcuts the agent uses at once. Each agent has its own
 * schedule, from every hour to every 30 days. Lessons and recipes take effect
 * without approval; a recipe only chains tools the agent may use anyway and
 * never runs a deletion or another action that needs confirmation.
 */

/** The units of the interval of a dream schedule. */
export const AGENT_DREAM_INTERVAL_UNITS = ["hours", "days"] as const;

/** Whether the interval counts hours or days. */
export type AgentDreamIntervalUnit =
  (typeof AGENT_DREAM_INTERVAL_UNITS)[number];

/** The lowest and the highest interval per unit: from every hour to every 30 days. */
export const AGENT_DREAM_INTERVAL_RANGE = {
  hours: { minimum: 1, maximum: 720 },
  days: { minimum: 1, maximum: 30 },
} as const;

/** The interval in days at which a weekday can be chosen ("jeden Montag"). */
export const AGENT_DREAM_WEEKLY_DAYS = 7;

/** The weekdays of a weekly schedule, 1 (Monday) to 7 (Sunday). */
export const AGENT_DREAM_WEEKDAY_RANGE = { minimum: 1, maximum: 7 } as const;

/** What started a dream run. */
export type AgentDreamTrigger = "schedule" | "manual" | "logbook";

/** How a dream run ended: it changed something, found nothing new, or failed. */
export type AgentDreamRunStatus = "updated" | "unchanged" | "failed";

/** The schedule of the dream run of one agent. */
export interface AgentDreamSchedule {
  /** The dream run is on; off stops the schedule and the trigger of the Lagebuch. */
  readonly isEnabled: boolean;
  /** How many hours or days lie between two runs. */
  readonly interval: number;
  readonly unit: AgentDreamIntervalUnit;
  /** `HH:MM` for a schedule in days; `null` follows the time of the instance. Ignored for hours. */
  readonly time: string | null;
  /** 1 (Monday) to 7 (Sunday) at an interval of 7 days; `null` otherwise. */
  readonly weekday: number | null;
  /** A run is asked for once the Lagebuch is about 80 % full. */
  readonly isOnFullLogbook: boolean;
}

/** The schedule a new agent starts with: daily at the time of the instance. */
export const AGENT_DREAM_DEFAULT_SCHEDULE: AgentDreamSchedule = {
  isEnabled: true,
  interval: 1,
  unit: "days",
  time: null,
  weekday: null,
  isOnFullLogbook: true,
};

/** A model the dream run can run on. */
export interface AgentDreamModelChoice {
  readonly connectionId: string;
  readonly model: string;
  /** The name as the lists show it. */
  readonly label: string;
}

/** The kinds of line in the log of a dream run, in the order the log shows them. */
export const AGENT_DREAM_LOG_KINDS = [
  "memoryTaken",
  "memoryDropped",
  "lessonLearned",
  "lessonStrengthened",
  "lessonDropped",
  "recipeCreated",
  "recipeUpdated",
  "recipeDropped",
] as const;

/** What a dream run did to the memory, the lessons and the recipes. */
export type AgentDreamLogKind = (typeof AGENT_DREAM_LOG_KINDS)[number];

/** One line of the log of a run. */
export interface AgentDreamLogEntry {
  readonly kind: AgentDreamLogKind;
  readonly text: string;
}

/** How many entries a run touched, per kind of the log. */
export type AgentDreamCounts = Readonly<Record<AgentDreamLogKind, number>>;

/** The counts of a run that did nothing. */
export const AGENT_DREAM_NO_COUNTS: AgentDreamCounts = {
  memoryTaken: 0,
  memoryDropped: 0,
  lessonLearned: 0,
  lessonStrengthened: 0,
  lessonDropped: 0,
  recipeCreated: 0,
  recipeUpdated: 0,
  recipeDropped: 0,
};

/** A finished run as the tab shows it. */
export interface AgentDreamRunView {
  /** ISO time the run ended. */
  readonly at: string;
  readonly status: AgentDreamRunStatus;
  readonly trigger: AgentDreamTrigger | null;
  /** A stable code when the run failed. */
  readonly errorCode: string | null;
  readonly counts: AgentDreamCounts;
  /** What was taken over, learned, created or dropped; empty for a viewer who may not read it. */
  readonly log: readonly AgentDreamLogEntry[];
}

/** The size of one of the two files of the memory. */
export interface AgentDreamFileSize {
  readonly characters: number;
  readonly limit: number;
}

/** What the tab "Dreaming" shows for one agent. */
export interface AgentDreamingOverview {
  readonly agentId: string;
  readonly agentName: string;
  readonly schedule: AgentDreamSchedule;
  /** The time of day of the instance, `HH:MM`; a schedule in days without a time uses it. */
  readonly instanceTime: string;
  /** The model of the run; `null` is the agent's own model. */
  readonly model: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
  /** The label of the agent's own model, for "Modell des Agents". */
  readonly ownModelLabel: string | null;
  /** The models an administrator can choose from; empty for everybody else. */
  readonly models: readonly AgentDreamModelChoice[];
  /** ISO time of the next run; `null` while the dream run is off. */
  readonly nextRunAt: string | null;
  /** A run is going on now. */
  readonly isRunning: boolean;
  /** A run is due but waits until the agent works in no chat. */
  readonly isWaiting: boolean;
  readonly lastRun: AgentDreamRunView | null;
  readonly memory: AgentDreamFileSize;
  readonly dream: AgentDreamFileSize & { readonly lessons: number };
  /** The Lagebuch: its entries, its fill and the fill at which a run is asked for. */
  readonly logbook: {
    readonly count: number;
    readonly fillPercent: number;
    readonly triggerPercent: number;
  };
  /** The text of `MEMORY.md` and `DREAM.md`; `null` for a viewer who may not read them. */
  readonly files: { readonly memory: string; readonly dream: string } | null;
  /** Whether the viewer may save the schedule and start a run. */
  readonly canChange: boolean;
}

/** Why a request about Dreaming, lessons or recipes was refused. */
export type AgentDreamingFailure =
  "forbidden" | "notFound" | "invalidInput" | "conflict" | "unavailable";

/** The answer of the endpoint of Dreaming. */
export type AgentDreamingResponse =
  | {
      readonly ok: true;
      readonly overview: AgentDreamingOverview;
      /** After `run-now`: `started`, or `waiting` while the agent works in a chat. */
      readonly run?: "started" | "waiting";
    }
  | { readonly ok: false; readonly error: AgentDreamingFailure };

/** The endpoint that reads the Dreaming of an agent, saves its schedule and starts a run. */
export const AGENT_DREAMING_ENDPOINT = "/chat-page-api/agent-dreaming";

/** One lesson of `DREAM.md` as the tab lists it. */
export interface AgentLessonView {
  /** Stable while the text stays; the endpoint finds the lesson by it. */
  readonly id: string;
  readonly text: string;
  /** What the lesson rests on. */
  readonly evidence: string;
  /** `YYYY-MM-DD` of the newest confirmation. */
  readonly date: string;
  /** How often it was confirmed; the weakest falls out first. */
  readonly strength: number;
  /** A lesson that is off stays in the file but is not loaded into a session. */
  readonly isActive: boolean;
}

/** The two kinds of recipe. */
export const AGENT_RECIPE_KINDS = ["flow", "knowledge"] as const;

/** A flow recipe is a fixed chain of tool calls, a knowledge recipe a short guide. */
export type AgentRecipeKind = (typeof AGENT_RECIPE_KINDS)[number];

/** Why a recipe is off. */
export type AgentRecipeDisabledReason = "failed" | "manual";

/** Who made a recipe. */
export type AgentRecipeOrigin = "dream" | "manual";

/** The longest name of a recipe. */
export const AGENT_RECIPE_NAME_CHARACTERS = 40;
/** The most steps of a flow recipe. */
export const AGENT_RECIPE_STEP_LIMIT = 8;
/** The most parameters of a flow recipe. */
export const AGENT_RECIPE_PARAMETER_LIMIT = 8;
/** Characters of the short description of a recipe. */
export const AGENT_RECIPE_SUMMARY_CHARACTERS = 160;
/** Characters of the guide of a knowledge recipe. */
export const AGENT_RECIPE_BODY_CHARACTERS = 1_500;
/** The most recipes one agent keeps; the weakest fall out first. */
export const AGENT_RECIPE_LIMIT = 40;
/** Failures in a row after which a recipe is switched off. */
export const AGENT_RECIPE_FAILURE_LIMIT = 2;

/** A parameter a flow recipe takes; its steps name it as `{{name}}`. */
export interface AgentRecipeParameter {
  readonly name: string;
  readonly description: string;
}

/**
 * One step of a flow recipe: a tool and its input, in which `{{name}}` stands
 * for a parameter of the recipe and `{{2.ticket.id}}` for a field of the
 * result of an earlier step (here step 2, counted from 1).
 */
export interface AgentRecipeStep {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** What the step is for, in a few words. */
  readonly note: string;
}

/** One recipe as the tab lists it. */
export interface AgentRecipeView {
  readonly id: string;
  /** The name `rezept(name, parameter)` is called with. */
  readonly name: string;
  readonly kind: AgentRecipeKind;
  /** A short description; what the list in the session shows beside the name. */
  readonly summary: string;
  /** Words that make a knowledge recipe fit a topic. */
  readonly keywords: readonly string[];
  readonly parameters: readonly AgentRecipeParameter[];
  /** The tool chain of a flow recipe; empty for a knowledge recipe. */
  readonly steps: readonly AgentRecipeStep[];
  /** The guide of a knowledge recipe; empty for a flow recipe. */
  readonly body: string;
  /** What the recipe rests on. */
  readonly evidence: string;
  /** `YYYY-MM-DD` of the newest confirmation. */
  readonly date: string;
  readonly strength: number;
  readonly useCount: number;
  /** ISO time of the last use; `null` when never used. */
  readonly lastUsedAt: string | null;
  readonly isActive: boolean;
  /** Set while the recipe is off. */
  readonly disabledReason: AgentRecipeDisabledReason | null;
  /** How many calls in a row failed. */
  readonly failureStreak: number;
  /** What the last failed call reported. */
  readonly lastError: string | null;
  readonly origin: AgentRecipeOrigin;
}

/** What the tab "Lektionen & Rezepte" shows for one agent. */
export interface AgentLessonsOverview {
  readonly agentId: string;
  readonly agentName: string;
  readonly lessons: readonly AgentLessonView[];
  readonly recipes: readonly AgentRecipeView[];
  /** Characters `DREAM.md` uses and the limit of the agent. */
  readonly dream: AgentDreamFileSize;
  /** Whether the viewer may read and change lessons and recipes. */
  readonly canChange: boolean;
}

/** The answer of the endpoint of lessons and recipes. */
export type AgentLessonsResponse =
  | { readonly ok: true; readonly overview: AgentLessonsOverview }
  | { readonly ok: false; readonly error: AgentDreamingFailure };

/** The endpoint that reads and changes the lessons and recipes of an agent. */
export const AGENT_LESSONS_ENDPOINT = "/chat-page-api/agent-lessons";

/** What `rezept` answers: whether the call worked, a stable error code, and what the model reads. */
export interface AgentRecipeAnswer {
  readonly isOk: boolean;
  readonly error: string | null;
  readonly result: unknown;
}

/**
 * The tools of the recipes an agent session is given (PAGE-378).
 */
export interface AgentRecipeTools {
  /**
   * `rezept(name, parameter)`: runs the flow recipe, hands over the guide of a
   * knowledge recipe, or lists the recipes without a name. `runner` calls one
   * tool of the session for each step.
   */
  run(
    input: unknown,
    runner: AgentRecipeStepRunner,
  ): Promise<AgentRecipeAnswer>;
  /** Notes one call of a tool of the session for the next dream run. */
  note(call: AgentToolUse): void;
}

/** One call of a tool, as the dream run learns from it. */
export interface AgentToolUse {
  readonly tool: string;
  /** The input, bounded and with credentials masked. */
  readonly input: string;
  /** The start of the result, bounded and with credentials masked. */
  readonly output: string;
  readonly isOk: boolean;
  /** The error code of a failed call. */
  readonly error: string | null;
}

/** What a recipe step is run with: the tool of the session, called as the agent would. */
export interface AgentRecipeStepRunner {
  /** Whether the session offers the tool and the agent may use it. */
  readonly offers: (tool: string) => "ok" | "unknown" | "confirmation";
  /** Calls the tool; the result is the JSON text the tool answers. */
  readonly call: (
    tool: string,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<
    | { readonly isOk: true; readonly result: string }
    | {
        readonly isOk: false;
        readonly error: string;
        readonly result: string | null;
      }
  >;
}
