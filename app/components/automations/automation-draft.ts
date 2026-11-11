import { isoToZonedInput, zonedTomorrow } from "./automation-zoned-time";

import type {
  Automation,
  AutomationAction,
  AutomationActionType,
  AutomationEventType,
  AutomationForwardCondition,
  AutomationNotificationMode,
  AutomationOptions,
  AutomationSharing,
  AutomationTimeUnit,
  AutomationTrigger,
} from "@/definition/Automation";

/** The three choices of "Auslöser". */
export type DraftTriggerKind = "time" | "event" | "manual";
/** The two choices of "Wiederholung". */
export type DraftRepeat = "once" | "interval";
/** "Alle N Einheiten" or "an Wochentagen um". */
export type DraftIntervalMode = "every" | "weekly";

/**
 * The editor's state of one automation, flat and as the inputs hold it.
 *
 * @remarks
 * Numbers stay text while typed; `sharing` is `private`, `project:<id>` or
 * `group:<id>`; an empty reference means "none" or "all". `content` is
 * `null` when the account may not read the script.
 */
export interface AutomationDraft {
  readonly name: string;
  readonly isActive: boolean;
  readonly triggerKind: DraftTriggerKind;
  readonly repeat: DraftRepeat;
  readonly intervalMode: DraftIntervalMode;
  readonly date: string;
  readonly time: string;
  readonly timeZone: string;
  readonly deleteAfterSuccess: boolean;
  readonly every: string;
  readonly unit: AutomationTimeUnit;
  readonly weekdays: readonly number[];
  readonly times: readonly string[];
  readonly hasWindow: boolean;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly eventType: AutomationEventType;
  readonly planId: string;
  readonly stepId: string;
  readonly projectId: string;
  readonly statusId: string;
  readonly actionType: AutomationActionType;
  readonly agentId: string;
  readonly instruction: string;
  readonly workspaceId: string;
  readonly interpreterProfileId: string;
  readonly content: string | null;
  readonly timeoutSeconds: string;
  readonly forwardAgentId: string;
  readonly forwardWhen: AutomationForwardCondition;
  readonly actionPlanId: string;
  readonly sharing: string;
  readonly notificationMode: AutomationNotificationMode;
  readonly notificationAgentId: string;
}

/** Changes some fields of a draft. */
export type DraftChange = (patch: Partial<AutomationDraft>) => void;

const WORKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const EVERY_DAY: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** The plan events; the others are ticket events. */
export const PLAN_EVENT_TYPES: ReadonlySet<AutomationEventType> = new Set([
  "plan.started",
  "plan.succeeded",
  "plan.failed",
  "plan.step_changed",
]);

/**
 * A new automation: once tomorrow at 09:00 in the default time zone, as an
 * order to the first agent, private and active.
 */
export function emptyDraft(
  options: AutomationOptions,
  now: Date,
): AutomationDraft {
  const firstAgent = options.agents[0]?.id ?? "";
  return {
    name: "",
    isActive: true,
    triggerKind: "time",
    repeat: "once",
    intervalMode: "every",
    date: zonedTomorrow(now, options.defaultTimeZone),
    time: "09:00",
    timeZone: options.defaultTimeZone,
    deleteAfterSuccess: false,
    every: "15",
    unit: "minute",
    weekdays: WORKDAYS,
    times: ["08:00"],
    hasWindow: false,
    windowStart: "08:00",
    windowEnd: "18:00",
    eventType: "plan.failed",
    planId: "",
    stepId: "",
    projectId: options.projects[0]?.id ?? "",
    statusId: "",
    actionType: "agent",
    agentId: firstAgent,
    instruction: "",
    workspaceId: options.workspaces[0]?.id ?? "",
    interpreterProfileId: options.interpreterProfiles[0]?.id ?? "",
    content: "",
    timeoutSeconds: String(options.limits.script.timeoutSeconds.initial),
    forwardAgentId: "",
    forwardWhen: "nonzero",
    actionPlanId: options.plans.find((plan) => plan.canStart)?.id ?? "",
    sharing: "private",
    notificationMode: "off",
    notificationAgentId: firstAgent,
  };
}

function triggerFields(trigger: AutomationTrigger): Partial<AutomationDraft> {
  switch (trigger.type) {
    case "manual":
      return { triggerKind: "manual" };
    case "once":
      return {
        triggerKind: "time",
        repeat: "once",
        timeZone: trigger.timeZone,
        ...isoToZonedInput(trigger.at, trigger.timeZone),
      };
    case "interval":
      return {
        triggerKind: "time",
        repeat: "interval",
        intervalMode: "every",
        every: String(trigger.every),
        unit: trigger.unit,
        timeZone: trigger.timeZone,
        weekdays: trigger.weekdays?.length ? trigger.weekdays : EVERY_DAY,
        ...windowFields(trigger.window),
      };
    case "weekly":
      return {
        triggerKind: "time",
        repeat: "interval",
        intervalMode: "weekly",
        weekdays: trigger.weekdays,
        times: trigger.times,
        timeZone: trigger.timeZone,
        ...windowFields(trigger.window),
      };
    case "event":
      return {
        triggerKind: "event",
        eventType: trigger.eventType,
        planId: trigger.planId ?? "",
        stepId: trigger.stepId ?? "",
        projectId: trigger.projectId ?? "",
        statusId: trigger.statusId ?? "",
      };
  }
}

function windowFields(
  window: { readonly start: string; readonly end: string } | undefined,
): Partial<AutomationDraft> {
  if (!window) return { hasWindow: false };
  return { hasWindow: true, windowStart: window.start, windowEnd: window.end };
}

function actionFields(action: AutomationAction): Partial<AutomationDraft> {
  switch (action.type) {
    case "agent":
      return {
        actionType: "agent",
        agentId: action.agentId,
        instruction: action.instruction,
      };
    case "plan":
      return { actionType: "plan", actionPlanId: action.planId };
    case "script":
      return {
        actionType: "script",
        workspaceId: action.workspaceId,
        interpreterProfileId: action.interpreterProfileId,
        content: action.content,
        timeoutSeconds: String(action.timeoutSeconds),
        forwardAgentId: action.forward?.agentId ?? "",
        forwardWhen: action.forward?.when ?? "nonzero",
      };
  }
}

/** Encodes a sharing as the value of the "Freigabe" select. */
export function sharingValue(sharing: AutomationSharing): string {
  if (sharing.scope === "project") return `project:${sharing.projectId}`;
  if (sharing.scope === "group") return `group:${sharing.groupId}`;
  return "private";
}

/** Reads the value of the "Freigabe" select. */
export function sharingFromValue(value: string): AutomationSharing {
  if (value.startsWith("project:"))
    return { scope: "project", projectId: value.slice("project:".length) };
  if (value.startsWith("group:"))
    return { scope: "group", groupId: value.slice("group:".length) };
  return { scope: "private" };
}

/** The draft of a saved automation, on top of the defaults for the fields it does not use. */
export function draftFromAutomation(
  automation: Automation,
  options: AutomationOptions,
  now: Date,
): AutomationDraft {
  const notification = automation.agentNotification;
  return {
    ...emptyDraft(options, now),
    ...triggerFields(automation.trigger),
    ...actionFields(automation.action),
    name: automation.name,
    isActive: automation.isActive,
    deleteAfterSuccess: automation.deleteAfterSuccess,
    sharing: sharingValue(automation.sharing),
    notificationMode: notification.mode,
    notificationAgentId: notification.agentId ?? options.agents[0]?.id ?? "",
  };
}
