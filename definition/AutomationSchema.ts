import { z } from "zod";

import {
  AUTOMATION_EVENT_TYPES,
  AUTOMATION_FORWARD_CONDITIONS,
  AUTOMATION_INSTRUCTION_LENGTH,
  AUTOMATION_INTERVAL_SECONDS,
  AUTOMATION_NAME_LENGTH,
  AUTOMATION_NOTIFICATION_MODES,
  AUTOMATION_TARGET_CHAT_LENGTH,
  AUTOMATION_TIME_UNITS,
  AUTOMATION_UNIT_SECONDS,
} from "./Automation";
import {
  PLAN_SCRIPT_CONTENT_LENGTH,
  PLAN_SCRIPT_TIMEOUT,
} from "./AgentPlanScript";

import type {
  AutomationAction,
  AutomationAgentNotification,
  AutomationSharing,
  AutomationTrigger,
} from "./Automation";

/** `HH:MM` on a 24-hour clock. */
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** A reference to another record; Pages checks that it exists and is usable. */
export const automationReferenceSchema = z.string().min(1).max(200);

/**
 * The target chat of an agent action (PAGE-376): `@Agentname`, `[[Chatname]]`
 * or empty for the direct chat of the owner with the agent.
 */
export const automationTargetChatSchema = z
  .string()
  .trim()
  .max(AUTOMATION_TARGET_CHAT_LENGTH)
  .regex(/^(?:@\S.*|\[\[[^\]]+\]\])?$/u);

/**
 * Tells whether a name is an IANA time zone this runtime can compute with.
 *
 * @param name - The time zone, such as `Europe/Berlin`.
 */
export function isAutomationTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isAutomationTimeZone, { message: "time_zone_unknown" });

const timeSchema = z.string().regex(TIME_PATTERN);

const weekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: "weekdays_duplicate",
  });

const windowSchema = z.strictObject({ start: timeSchema, end: timeSchema });

const intervalSchema = z
  .strictObject({
    type: z.literal("interval"),
    every: z.number().int().min(1),
    unit: z.enum(AUTOMATION_TIME_UNITS),
    timeZone: timeZoneSchema,
    weekdays: weekdaysSchema.optional(),
    window: windowSchema.optional(),
  })
  .refine(
    (trigger) =>
      trigger.every * AUTOMATION_UNIT_SECONDS[trigger.unit] <=
      AUTOMATION_INTERVAL_SECONDS.maximum,
    { message: "interval_too_long", path: ["every"] },
  );

const weeklySchema = z.strictObject({
  type: z.literal("weekly"),
  weekdays: weekdaysSchema,
  times: z
    .array(timeSchema)
    .min(1)
    .max(48)
    .refine((times) => new Set(times).size === times.length, {
      message: "times_duplicate",
    }),
  timeZone: timeZoneSchema,
  window: windowSchema.optional(),
});

const PLAN_EVENTS: ReadonlySet<string> = new Set([
  "plan.started",
  "plan.succeeded",
  "plan.failed",
  "plan.step_changed",
]);

const eventSchema = z
  .strictObject({
    type: z.literal("event"),
    eventType: z.enum(AUTOMATION_EVENT_TYPES),
    planId: automationReferenceSchema.nullable().optional(),
    stepId: automationReferenceSchema.nullable().optional(),
    projectId: automationReferenceSchema.nullable().optional(),
    statusId: automationReferenceSchema.nullable().optional(),
  })
  .superRefine((trigger, context) => {
    const isPlanEvent = PLAN_EVENTS.has(trigger.eventType);
    const misplaced = isPlanEvent
      ? [trigger.projectId, trigger.statusId]
      : [trigger.planId, trigger.stepId];
    if (misplaced.some((value) => value !== undefined && value !== null))
      context.addIssue({ code: "custom", message: "event_filter_mismatch" });
    if (!isPlanEvent && !trigger.projectId)
      context.addIssue({
        code: "custom",
        message: "event_project_required",
        path: ["projectId"],
      });
    if (trigger.stepId && trigger.eventType !== "plan.step_changed")
      context.addIssue({ code: "custom", message: "event_filter_mismatch" });
    if (trigger.stepId && !trigger.planId)
      context.addIssue({
        code: "custom",
        message: "event_plan_required",
        path: ["planId"],
      });
    if (trigger.statusId && trigger.eventType !== "ticket.status_changed")
      context.addIssue({ code: "custom", message: "event_filter_mismatch" });
  });

/**
 * A trigger as stored and as read: a once trigger may have lost its time.
 *
 * @remarks
 * Input of a change additionally needs a time in the future for a once
 * trigger; the automation service checks that against its clock.
 */
export const automationTriggerSchema: z.ZodType<AutomationTrigger> = z.union([
  z.strictObject({ type: z.literal("manual") }),
  z.strictObject({
    type: z.literal("once"),
    at: z.iso.datetime({ offset: true }).nullable(),
    timeZone: timeZoneSchema,
  }),
  intervalSchema,
  weeklySchema,
  eventSchema,
]);

const forwardSchema = z.strictObject({
  agentId: automationReferenceSchema,
  when: z.enum(AUTOMATION_FORWARD_CONDITIONS),
});

/** An action as written; a script's content is required. */
export const automationActionSchema: z.ZodType<AutomationAction> = z.union([
  z.strictObject({
    type: z.literal("agent"),
    agentId: automationReferenceSchema,
    instruction: z.string().trim().min(1).max(AUTOMATION_INSTRUCTION_LENGTH),
    chat: automationTargetChatSchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("script"),
    workspaceId: automationReferenceSchema,
    interpreterProfileId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9-]+$/u),
    content: z.string().min(1).max(PLAN_SCRIPT_CONTENT_LENGTH),
    timeoutSeconds: z
      .number()
      .int()
      .min(PLAN_SCRIPT_TIMEOUT.minimum)
      .max(PLAN_SCRIPT_TIMEOUT.maximum),
    forward: forwardSchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("plan"),
    planId: automationReferenceSchema,
  }),
]);

/** Who sees an automation besides its creator. */
export const automationSharingSchema: z.ZodType<AutomationSharing> = z.union([
  z.strictObject({ scope: z.literal("private") }),
  z.strictObject({
    scope: z.literal("project"),
    projectId: automationReferenceSchema,
  }),
  z.strictObject({
    scope: z.literal("group"),
    groupId: automationReferenceSchema,
  }),
]);

/** The optional agent notification; an active mode names its agent. */
export const automationAgentNotificationSchema: z.ZodType<AutomationAgentNotification> =
  z
    .strictObject({
      mode: z.enum(AUTOMATION_NOTIFICATION_MODES),
      agentId: automationReferenceSchema.nullable().optional(),
    })
    .refine(
      (notification) => notification.mode === "off" || notification.agentId,
      {
        message: "notification_agent_required",
        path: ["agentId"],
      },
    );

/** The name of an automation, without surrounding spaces. */
export const automationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(AUTOMATION_NAME_LENGTH);
