import { expect, it } from "vitest";

import {
  automationAgentNotificationSchema,
  automationTargetChatSchema,
  automationTriggerSchema,
  isAutomationTimeZone,
} from "@/definition/AutomationSchema";

it("validates scheduling bounds, uniqueness and time zones", () => {
  expect(isAutomationTimeZone("Europe/Berlin")).toBe(true);
  expect(isAutomationTimeZone("Not/AZone")).toBe(false);
  expect(
    automationTriggerSchema.safeParse({
      type: "interval",
      every: 1,
      unit: "hour",
      timeZone: "UTC",
    }).success,
  ).toBe(true);
  expect(
    automationTriggerSchema.safeParse({
      type: "interval",
      every: 366,
      unit: "day",
      timeZone: "UTC",
    }).success,
  ).toBe(false);
  expect(
    automationTriggerSchema.safeParse({
      type: "weekly",
      weekdays: [1, 1],
      times: ["09:00"],
      timeZone: "UTC",
    }).success,
  ).toBe(false);
  expect(
    automationTriggerSchema.safeParse({
      type: "weekly",
      weekdays: [1],
      times: ["09:00", "09:00"],
      timeZone: "UTC",
    }).success,
  ).toBe(false);
});

it.each([
  [
    {
      type: "event",
      eventType: "plan.step_changed",
      planId: "plan",
      stepId: "step",
    },
    true,
  ],
  [{ type: "event", eventType: "plan.step_changed", stepId: "step" }, false],
  [
    {
      type: "event",
      eventType: "plan.started",
      planId: "plan",
      stepId: "step",
    },
    false,
  ],
  [{ type: "event", eventType: "plan.started", projectId: "project" }, false],
  [{ type: "event", eventType: "ticket.created", projectId: "project" }, true],
  [{ type: "event", eventType: "ticket.created" }, false],
  [
    {
      type: "event",
      eventType: "ticket.created",
      projectId: "project",
      statusId: "status",
    },
    false,
  ],
  [
    {
      type: "event",
      eventType: "ticket.status_changed",
      projectId: "project",
      statusId: "status",
    },
    true,
  ],
  [{ type: "event", eventType: "storage.limit_exceeded" }, true],
  [
    {
      type: "event",
      eventType: "storage.limit_exceeded",
      projectId: "project",
    },
    false,
  ],
])("validates event filter combinations", (trigger, valid) => {
  expect(automationTriggerSchema.safeParse(trigger).success).toBe(valid);
});

it("validates chat targets and notification recipients", () => {
  expect(automationTargetChatSchema.parse(" @Agent ")).toBe("@Agent");
  expect(automationTargetChatSchema.safeParse("[[Team]]").success).toBe(true);
  expect(automationTargetChatSchema.safeParse("unmarked").success).toBe(false);
  expect(
    automationAgentNotificationSchema.safeParse({ mode: "off" }).success,
  ).toBe(true);
  expect(
    automationAgentNotificationSchema.safeParse({ mode: "always" }).success,
  ).toBe(false);
});
