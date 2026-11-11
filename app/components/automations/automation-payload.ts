import {
  AUTOMATION_INTERVAL_SECONDS,
  AUTOMATION_UNIT_SECONDS,
} from "@/definition/Automation";

import { PLAN_EVENT_TYPES, sharingFromValue } from "./automation-draft";
import { isClockTime, zonedInputToIso } from "./automation-zoned-time";

import type {
  Automation,
  AutomationAction,
  AutomationAgentNotification,
  AutomationOptions,
  AutomationSharing,
  AutomationTrigger,
  AutomationWindow,
} from "@/definition/Automation";
import type { AutomationDraft } from "./automation-draft";

/** A field of the editor that holds an unusable value. */
export type DraftProblem =
  | "name"
  | "time"
  | "every"
  | "weekdays"
  | "times"
  | "window"
  | "project"
  | "agent"
  | "instruction"
  | "workspace"
  | "interpreter"
  | "content"
  | "timeout"
  | "plan"
  | "notificationAgent";

/** A value built from the draft, or the field that prevents it. */
export type Built<T> =
  | { readonly value: T; readonly problem?: undefined }
  | { readonly problem: DraftProblem };

/** The input of `create` as the page sends it. */
export interface AutomationCreatePayload {
  readonly operationId: string;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly sharing: AutomationSharing;
  readonly isActive: boolean;
  readonly deleteAfterSuccess: boolean;
  readonly agentNotification: AutomationAgentNotification;
}

/** The input of `update` as the page sends it; unchanged parts may be left out. */
export interface AutomationUpdatePayload {
  readonly operationId: string;
  readonly automationId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly trigger?: AutomationTrigger;
  readonly action?: AutomationAction;
  readonly sharing: AutomationSharing;
  readonly isActive?: boolean;
  readonly deleteAfterSuccess: boolean;
  readonly agentNotification: AutomationAgentNotification;
}

/** What building a payload needs besides the draft. */
export interface PayloadContext {
  readonly options: AutomationOptions;
  readonly now: Date;
  readonly operationId: string;
}

function byNumber(left: number, right: number): number {
  return left - right;
}

function readWholeNumber(text: string): number | null {
  if (!/^\d+$/u.test(text.trim())) return null;
  return Number(text.trim());
}

function buildWindow(
  draft: AutomationDraft,
): Built<AutomationWindow | undefined> {
  if (!draft.hasWindow) return { value: undefined };
  if (!isClockTime(draft.windowStart) || !isClockTime(draft.windowEnd))
    return { problem: "window" };
  return { value: { start: draft.windowStart, end: draft.windowEnd } };
}

function buildOnce(
  draft: AutomationDraft,
  now: Date,
): Built<AutomationTrigger> {
  const at = zonedInputToIso(
    { date: draft.date, time: draft.time },
    draft.timeZone,
  );
  if (!at || new Date(at).getTime() <= now.getTime())
    return { problem: "time" };
  return { value: { type: "once", at, timeZone: draft.timeZone } };
}

function buildEvery(draft: AutomationDraft): Built<AutomationTrigger> {
  const every = readWholeNumber(draft.every);
  if (
    every === null ||
    every < 1 ||
    every * AUTOMATION_UNIT_SECONDS[draft.unit] >
      AUTOMATION_INTERVAL_SECONDS.maximum
  )
    return { problem: "every" };
  const window = buildWindow(draft);
  if (window.problem) return window;
  const hasDays = draft.weekdays.length > 0 && draft.weekdays.length < 7;
  return {
    value: {
      type: "interval",
      every,
      unit: draft.unit,
      timeZone: draft.timeZone,
      ...(hasDays ? { weekdays: [...draft.weekdays].sort(byNumber) } : {}),
      ...(window.value ? { window: window.value } : {}),
    },
  };
}

function buildWeekly(draft: AutomationDraft): Built<AutomationTrigger> {
  if (draft.weekdays.length === 0) return { problem: "weekdays" };
  const times = draft.times.map((time) => time.trim());
  if (
    times.length === 0 ||
    !times.every(isClockTime) ||
    new Set(times).size !== times.length
  )
    return { problem: "times" };
  const window = buildWindow(draft);
  if (window.problem) return window;
  return {
    value: {
      type: "weekly",
      weekdays: [...draft.weekdays].sort(byNumber),
      times: [...times].sort(),
      timeZone: draft.timeZone,
      ...(window.value ? { window: window.value } : {}),
    },
  };
}

function buildEvent(draft: AutomationDraft): Built<AutomationTrigger> {
  const { eventType } = draft;
  if (PLAN_EVENT_TYPES.has(eventType)) {
    const planId = draft.planId === "" ? null : draft.planId;
    const hasStep = eventType === "plan.step_changed";
    return {
      value: {
        type: "event",
        eventType,
        planId,
        ...(hasStep
          ? { stepId: planId && draft.stepId ? draft.stepId : null }
          : {}),
      },
    };
  }
  if (draft.projectId === "") return { problem: "project" };
  const hasStatus = eventType === "ticket.status_changed";
  return {
    value: {
      type: "event",
      eventType,
      projectId: draft.projectId,
      ...(hasStatus
        ? { statusId: draft.statusId === "" ? null : draft.statusId }
        : {}),
    },
  };
}

/** Builds the trigger of a draft; a once trigger needs a time in the future. */
export function buildTrigger(
  draft: AutomationDraft,
  now: Date,
): Built<AutomationTrigger> {
  if (draft.triggerKind === "manual") return { value: { type: "manual" } };
  if (draft.triggerKind === "event") return buildEvent(draft);
  if (draft.repeat === "once") return buildOnce(draft, now);
  return draft.intervalMode === "weekly"
    ? buildWeekly(draft)
    : buildEvery(draft);
}

function buildScript(
  draft: AutomationDraft,
  options: AutomationOptions,
): Built<AutomationAction> {
  if (draft.workspaceId === "") return { problem: "workspace" };
  if (draft.interpreterProfileId === "") return { problem: "interpreter" };
  if (!draft.content?.trim()) return { problem: "content" };
  const limits = options.limits.script.timeoutSeconds;
  const timeoutSeconds = readWholeNumber(draft.timeoutSeconds);
  if (
    timeoutSeconds === null ||
    timeoutSeconds < limits.minimum ||
    timeoutSeconds > limits.maximum
  )
    return { problem: "timeout" };
  return {
    value: {
      type: "script",
      workspaceId: draft.workspaceId,
      interpreterProfileId: draft.interpreterProfileId,
      content: draft.content,
      timeoutSeconds,
      forward:
        draft.forwardAgentId === ""
          ? null
          : { agentId: draft.forwardAgentId, when: draft.forwardWhen },
    },
  };
}

/** Builds the action of a draft. */
export function buildAction(
  draft: AutomationDraft,
  options: AutomationOptions,
): Built<AutomationAction> {
  switch (draft.actionType) {
    case "agent":
      if (draft.agentId === "") return { problem: "agent" };
      if (draft.instruction.trim() === "") return { problem: "instruction" };
      return {
        value: {
          type: "agent",
          agentId: draft.agentId,
          instruction: draft.instruction,
        },
      };
    case "plan":
      if (draft.actionPlanId === "") return { problem: "plan" };
      return { value: { type: "plan", planId: draft.actionPlanId } };
    case "script":
      return buildScript(draft, options);
  }
}

function buildNotification(
  draft: AutomationDraft,
): Built<AutomationAgentNotification> {
  if (draft.notificationMode === "off") return { value: { mode: "off" } };
  if (draft.notificationAgentId === "") return { problem: "notificationAgent" };
  return {
    value: { mode: draft.notificationMode, agentId: draft.notificationAgentId },
  };
}

function deletesAfterSuccess(draft: AutomationDraft): boolean {
  return (
    draft.triggerKind === "time" &&
    draft.repeat === "once" &&
    draft.deleteAfterSuccess
  );
}

/** Builds the input of `create` from the editor. */
export function buildCreatePayload(
  draft: AutomationDraft,
  context: PayloadContext,
): Built<AutomationCreatePayload> {
  if (draft.name.trim() === "") return { problem: "name" };
  const trigger = buildTrigger(draft, context.now);
  if (trigger.problem) return trigger;
  const action = buildAction(draft, context.options);
  if (action.problem) return action;
  const agentNotification = buildNotification(draft);
  if (agentNotification.problem) return agentNotification;
  return {
    value: {
      operationId: context.operationId,
      name: draft.name.trim(),
      trigger: trigger.value,
      action: action.value,
      sharing: sharingFromValue(draft.sharing),
      isActive: draft.isActive,
      deleteAfterSuccess: deletesAfterSuccess(draft),
      agentNotification: agentNotification.value,
    },
  };
}

/** The trigger to send with a change: left out while the person did not change it. */
function changedTrigger(
  draft: AutomationDraft,
  original: AutomationDraft,
  now: Date,
): Built<AutomationTrigger | undefined> {
  const trigger = buildTrigger(draft, now);
  if (JSON.stringify(trigger) === JSON.stringify(buildTrigger(original, now)))
    return { value: undefined };
  return trigger;
}

/** The action to send with a change: left out when the account cannot read the script. */
function changedAction(
  draft: AutomationDraft,
  options: AutomationOptions,
): Built<AutomationAction | undefined> {
  if (draft.actionType === "script" && draft.content === null)
    return { value: undefined };
  return buildAction(draft, options);
}

/**
 * Builds the input of `update` from the editor.
 *
 * @param draft - The edited state.
 * @param original - The draft of the automation before the edit.
 * @param automation - The automation as read, for its ID and revision.
 * @param context - Options, clock and operation ID.
 */
export function buildUpdatePayload(
  draft: AutomationDraft,
  original: AutomationDraft,
  automation: Automation,
  context: PayloadContext,
): Built<AutomationUpdatePayload> {
  if (draft.name.trim() === "") return { problem: "name" };
  const trigger = changedTrigger(draft, original, context.now);
  if (trigger.problem) return trigger;
  const action = changedAction(draft, context.options);
  if (action.problem) return action;
  const agentNotification = buildNotification(draft);
  if (agentNotification.problem) return agentNotification;
  return {
    value: {
      operationId: context.operationId,
      automationId: automation.id,
      expectedRevision: automation.revision,
      name: draft.name.trim(),
      ...(trigger.value ? { trigger: trigger.value } : {}),
      ...(action.value ? { action: action.value } : {}),
      sharing: sharingFromValue(draft.sharing),
      ...(draft.isActive === automation.isActive
        ? {}
        : { isActive: draft.isActive }),
      deleteAfterSuccess: deletesAfterSuccess(draft),
      agentNotification: agentNotification.value,
    },
  };
}
