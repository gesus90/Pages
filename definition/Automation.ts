/**
 * Automations (PAGE-297): jobs that wake an agent, run a script or start a
 * plan at a time, in an interval, on an event or by hand.
 *
 * @remarks
 * The interface, Pica, the agent tools and the HTTP API of the Pages MCP
 * client share these contracts. Times are ISO 8601, time zones IANA names.
 */

/** The longest name of an automation. */
export const AUTOMATION_NAME_LENGTH = 200;
/** The longest instruction of an agent action, as long as a chat message. */
export const AUTOMATION_INSTRUCTION_LENGTH = 20_000;
/** The stored part of an agent's final answer, in UTF-8 bytes. */
export const AUTOMATION_ANSWER_BYTES = 4096;
/** The end of a script's output a forwarded agent receives, in UTF-8 bytes. */
export const AUTOMATION_FORWARD_OUTPUT_BYTES = 65_536;
/** The runs kept per automation; older ones are removed. */
export const AUTOMATION_RUN_RETENTION = 50;
/** The shortest and the longest effective interval, in seconds (one year). */
export const AUTOMATION_INTERVAL_SECONDS = {
  minimum: 1,
  maximum: 31_536_000,
} as const;
/** Page sizes of every automation list. */
export const AUTOMATION_LIST_LIMIT = {
  minimum: 1,
  maximum: 100,
  initial: 50,
} as const;

/** The units of an interval. */
export const AUTOMATION_TIME_UNITS = [
  "second",
  "minute",
  "hour",
  "day",
] as const;
/** A unit of an interval. */
export type AutomationTimeUnit = (typeof AUTOMATION_TIME_UNITS)[number];

/** Seconds of one interval unit; a day counts as a calendar day of the time zone. */
export const AUTOMATION_UNIT_SECONDS: Readonly<
  Record<AutomationTimeUnit, number>
> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
};

/** The events an automation can wait for. */
export const AUTOMATION_EVENT_TYPES = [
  "plan.started",
  "plan.succeeded",
  "plan.failed",
  "plan.step_changed",
  "ticket.created",
  "ticket.status_changed",
] as const;
/** An event an automation can wait for. */
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

/** The kinds of trigger. */
export const AUTOMATION_TRIGGER_TYPES = [
  "manual",
  "once",
  "interval",
  "weekly",
  "event",
] as const;
/** A kind of trigger. */
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

/** The kinds of action. */
export const AUTOMATION_ACTION_TYPES = ["agent", "script", "plan"] as const;
/** A kind of action. */
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

/** When a script hands its result to an agent. */
export const AUTOMATION_FORWARD_CONDITIONS = [
  "always",
  "nonzero",
  "zero",
] as const;
/** When a script hands its result to an agent. */
export type AutomationForwardCondition =
  (typeof AUTOMATION_FORWARD_CONDITIONS)[number];

/** When an automation tells someone about the result of a run. */
export const AUTOMATION_NOTIFICATION_MODES = [
  "off",
  "error",
  "always",
] as const;
/** When an automation tells someone about the result of a run. */
export type AutomationNotificationMode =
  (typeof AUTOMATION_NOTIFICATION_MODES)[number];

/** Who sees an automation besides its creator. */
export const AUTOMATION_SHARING_SCOPES = [
  "private",
  "project",
  "group",
] as const;
/** Who sees an automation besides its creator. */
export type AutomationSharingScope = (typeof AUTOMATION_SHARING_SCOPES)[number];

/**
 * Where a run stands.
 *
 * @remarks
 * `queued` waits behind the running run of the same automation, `accepted`
 * is claimed and about to start or waits for a busy agent, `delivered` runs:
 * the script process, the plan run or the agent's turn has started.
 * `completed` and `failed` are final; only they carry a result.
 */
export const AUTOMATION_RUN_STATUSES = [
  "queued",
  "accepted",
  "delivered",
  "completed",
  "failed",
] as const;
/** Where a run stands. */
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/** How a finished run ended. */
export const AUTOMATION_RUN_OUTCOMES = [
  "ok",
  "failed",
  "forbidden",
  "skipped",
] as const;
/** How a finished run ended. */
export type AutomationRunOutcome = (typeof AUTOMATION_RUN_OUTCOMES)[number];

/** What a delivery to an agent is for. */
export const AUTOMATION_DELIVERY_KINDS = [
  "action",
  "forward",
  "notification",
] as const;
/** What a delivery to an agent is for. */
export type AutomationDeliveryKind = (typeof AUTOMATION_DELIVERY_KINDS)[number];

/**
 * Where a delivery to an agent stands: waiting in the agent's queue, its turn
 * started, its turn ended with an answer, or it failed.
 */
export const AUTOMATION_DELIVERY_STATES = [
  "queued",
  "delivered",
  "completed",
  "failed",
] as const;
/** Where a delivery to an agent stands. */
export type AutomationDeliveryState =
  (typeof AUTOMATION_DELIVERY_STATES)[number];

/** A daily time window, `HH:MM` to `HH:MM`; an end before the start crosses midnight. */
export interface AutomationWindow {
  readonly start: string;
  readonly end: string;
}

/** Runs only through "run now". */
export interface AutomationManualTrigger {
  readonly type: "manual";
}

/**
 * Runs once at a time.
 *
 * @remarks
 * `at` is `null` after the run or after switching off a passed time; the
 * automation can only be switched on again with a new time in the future.
 */
export interface AutomationOnceTrigger {
  readonly type: "once";
  readonly at: string | null;
  readonly timeZone: string;
}

/** Runs every N units, optionally only on weekdays and within a window. */
export interface AutomationIntervalTrigger {
  readonly type: "interval";
  readonly every: number;
  readonly unit: AutomationTimeUnit;
  readonly timeZone: string;
  /** ISO weekdays, 1 Monday to 7 Sunday. */
  readonly weekdays?: readonly number[];
  readonly window?: AutomationWindow;
}

/** Runs on weekdays at fixed times. */
export interface AutomationWeeklyTrigger {
  readonly type: "weekly";
  readonly weekdays: readonly number[];
  /** `HH:MM` times of the day. */
  readonly times: readonly string[];
  readonly timeZone: string;
  readonly window?: AutomationWindow;
}

/**
 * Runs when an event of Pages happens.
 *
 * @remarks
 * Plan events filter by `planId` (`null`: every visible plan) and, for step
 * changes, by `stepId`; ticket events by `projectId` and, for status
 * changes, by the target `statusId`.
 */
export interface AutomationEventTrigger {
  readonly type: "event";
  readonly eventType: AutomationEventType;
  readonly planId?: string | null;
  readonly stepId?: string | null;
  readonly projectId?: string | null;
  readonly statusId?: string | null;
}

/** When an automation starts. */
export type AutomationTrigger =
  | AutomationManualTrigger
  | AutomationOnceTrigger
  | AutomationIntervalTrigger
  | AutomationWeeklyTrigger
  | AutomationEventTrigger;

/** The longest target chat of an agent action. */
export const AUTOMATION_TARGET_CHAT_LENGTH = 200;

/**
 * Wakes an agent with an instruction in the session of a chat (PAGE-376).
 *
 * @remarks
 * `chat` names the target chat: `@Agentname` for the direct chat of the
 * owner of the automation with that agent, `[[Chatname]]` for a group the
 * owner and the agent belong to. Without it the direct chat of the owner
 * with the agent applies. The result appears there as a message of the agent.
 */
export interface AutomationAgentAction {
  readonly type: "agent";
  readonly agentId: string;
  readonly instruction: string;
  readonly chat?: string | null;
}

/** Hands the exit code and the end of the output of a script to an agent. */
export interface AutomationScriptForward {
  readonly agentId: string;
  readonly when: AutomationForwardCondition;
}

/**
 * Runs a script with an interpreter profile in a workspace.
 *
 * @remarks
 * `content` is `null` for an account that may only read the automation.
 */
export interface AutomationScriptAction {
  readonly type: "script";
  readonly workspaceId: string;
  readonly interpreterProfileId: string;
  readonly content: string | null;
  readonly timeoutSeconds: number;
  readonly forward?: AutomationScriptForward | null;
}

/** Starts a new run of a plan. */
export interface AutomationPlanAction {
  readonly type: "plan";
  readonly planId: string;
}

/** What an automation does. */
export type AutomationAction =
  AutomationAgentAction | AutomationScriptAction | AutomationPlanAction;

/** Who sees an automation; a share never grants rights to its runs. */
export type AutomationSharing =
  | { readonly scope: "private" }
  | { readonly scope: "project"; readonly projectId: string }
  | { readonly scope: "group"; readonly groupId: string };

/** The optional agent that receives the result of every or of failed runs. */
export interface AutomationAgentNotification {
  readonly mode: AutomationNotificationMode;
  readonly agentId?: string | null;
}

/** The account that created an automation; its runs run with its rights. */
export interface AutomationCreator {
  readonly accountId: string;
  readonly kind: "human" | "agent";
  readonly displayName: string;
}

/** What the reading account may do with an automation. */
export interface AutomationPermissions {
  readonly canRead: boolean;
  readonly canEdit: boolean;
  readonly canRun: boolean;
  readonly canDelete: boolean;
}

/** What started a run. */
export interface AutomationRunTrigger {
  readonly kind: AutomationTriggerType;
  readonly eventType?: AutomationEventType;
  /** The plan name or ticket key of an event, for display. */
  readonly subject?: string | null;
}

/** How a finished run ended, bounded for lists. */
export interface AutomationRunResult {
  readonly outcome: AutomationRunOutcome;
  readonly exitCode: number | null;
  /** Whether a script woke its forward agent; `null` without a forward. */
  readonly forward: "woken" | "not_woken" | null;
  readonly planRunId: string | null;
  readonly planRunStatus: string | null;
  /** Whether the run paused its automation. */
  readonly paused: boolean;
  /** A short machine code of a failure, such as `forbidden` or `timeout`. */
  readonly errorCode: string | null;
  /** The first line of the answer or of the error, at most 200 characters. */
  readonly summary: string | null;
}

/** One run in a list, newest first. */
export interface AutomationRunSummary {
  readonly runId: string;
  readonly automationId: string;
  readonly automationName: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly trigger: AutomationRunTrigger;
  readonly status: AutomationRunStatus;
  readonly result: AutomationRunResult | null;
  /** Milliseconds from start to end; `null` while not ended or never started. */
  readonly duration: number | null;
}

/** A delivery of a run to an agent, with its honest state. */
export interface AutomationDelivery {
  readonly agentId: string;
  readonly kind: AutomationDeliveryKind;
  readonly state: AutomationDeliveryState;
  readonly queuedAt: string;
  readonly deliveredAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
}

/** One run with its bounded outputs. */
export interface AutomationRunDetail extends AutomationRunSummary {
  /** The agent's final answer, at most 4 KiB. */
  readonly answer: string | null;
  /** The end of the script output, at most 64 KiB; `null` for readers. */
  readonly output: string | null;
  readonly error: string | null;
  /** The data the trigger handed to the action. */
  readonly triggerData: Readonly<Record<string, unknown>> | null;
  readonly deliveries: readonly AutomationDelivery[];
}

/** One automation as an account sees it. */
export interface Automation {
  readonly id: string;
  readonly revision: number;
  readonly creator: AutomationCreator;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly sharing: AutomationSharing;
  readonly isActive: boolean;
  readonly deleteAfterSuccess: boolean;
  readonly agentNotification: AutomationAgentNotification;
  readonly nextRunAt: string | null;
  readonly lastRun: AutomationRunSummary | null;
  readonly permissions: AutomationPermissions;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One page of a list. */
export interface AutomationPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}

/** A selectable reference with its display name. */
export interface AutomationChoice {
  readonly id: string;
  readonly name: string;
}

/** A selectable agent with its position. */
export interface AutomationAgentChoice extends AutomationChoice {
  readonly position: string | null;
}

/** A plan the account may start, with its steps for the step filter. */
export interface AutomationPlanChoice extends AutomationChoice {
  readonly projectName: string | null;
  readonly canStart: boolean;
  readonly steps: readonly AutomationChoice[];
}

/** A project for ticket events, with its statuses. */
export interface AutomationProjectChoice extends AutomationChoice {
  readonly statuses: readonly AutomationChoice[];
}

/** Whether a kind of trigger or action is offered to the account. */
export interface AutomationKindOption<Kind extends string> {
  readonly type: Kind;
  readonly isAllowed: boolean;
}

/** The limits every channel applies alike. */
export interface AutomationLimits {
  readonly nameLength: number;
  readonly instructionLength: number;
  readonly intervalSeconds: typeof AUTOMATION_INTERVAL_SECONDS;
  readonly answerBytes: number;
  readonly forwardOutputBytes: number;
  readonly runRetention: number;
  readonly list: typeof AUTOMATION_LIST_LIMIT;
  readonly script: {
    readonly contentLength: number;
    readonly timeoutSeconds: {
      readonly minimum: number;
      readonly maximum: number;
      readonly initial: number;
    };
    readonly stdoutBytes: number;
    readonly stderrBytes: number;
  };
}

/**
 * What an account may choose when it creates or changes an automation.
 *
 * @remarks
 * Only references and names, never credentials or executable paths. Script
 * actions, workspaces and interpreter profiles are offered to active
 * administrators only.
 */
export interface AutomationOptions {
  readonly triggers: readonly AutomationKindOption<AutomationTriggerType>[];
  readonly actions: readonly AutomationKindOption<AutomationActionType>[];
  readonly eventTypes: readonly AutomationEventType[];
  readonly schemas: Readonly<Record<string, unknown>>;
  readonly limits: AutomationLimits;
  readonly timeZones: readonly string[];
  readonly defaultTimeZone: string;
  readonly agents: readonly AutomationAgentChoice[];
  readonly plans: readonly AutomationPlanChoice[];
  readonly projects: readonly AutomationProjectChoice[];
  readonly sharing: {
    readonly projects: readonly AutomationChoice[];
    readonly groups: readonly AutomationChoice[];
  };
  readonly workspaces: readonly AutomationChoice[];
  readonly interpreterProfiles: readonly AutomationChoice[];
  /** An example of the data an event hands to the action, per event type. */
  readonly eventExamples: Readonly<Record<AutomationEventType, object>>;
}

/** The receipt of "run now": accepted or waiting, never a finished run. */
export interface AutomationRunReceipt {
  readonly runId: string;
  readonly automationId: string;
  readonly status: AutomationRunStatus;
  /** Whether the call joined a run that was already waiting. */
  readonly isCoalesced: boolean;
  readonly queuedAt: string;
}

/** What a deletion would remove; returned before the confirmed call. */
export interface AutomationDeletionScope {
  readonly confirmationRequired: true;
  readonly automationId: string;
  readonly name: string;
  readonly expectedRevision: number;
  readonly runCount: number;
  /** A run that blocks the deletion while it runs or waits. */
  readonly blockingRunId: string | null;
  readonly canDelete: boolean;
}

/** The receipt of a confirmed deletion. */
export interface AutomationDeleted {
  readonly automationId: string;
  readonly isDeleted: true;
  readonly removedRuns: number;
}
