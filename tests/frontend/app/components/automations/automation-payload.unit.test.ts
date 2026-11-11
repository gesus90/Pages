import { expect, it } from "vitest";

import { emptyDraft } from "@/app/components/automations/automation-draft";
import {
  buildAction,
  buildCreatePayload,
  buildTrigger,
  buildUpdatePayload,
} from "@/app/components/automations/automation-payload";

import { automation, now, options } from "./automation-fixture";

const draft = emptyDraft(options, now);
const context = { options, now, operationId: "operation" };

it("validates once times and builds a future instant", () => {
  expect(buildTrigger(draft, now)).toEqual({
    value: { type: "once", at: "2026-01-02T09:00:00+00:00", timeZone: "UTC" },
  });
  expect(buildTrigger({ ...draft, date: "2025-01-01" }, now)).toEqual({
    problem: "time",
  });
  expect(buildTrigger({ ...draft, time: "bad" }, now)).toEqual({
    problem: "time",
  });
  expect(buildTrigger({ ...draft, triggerKind: "manual" }, now)).toEqual({
    value: { type: "manual" },
  });
});

it("validates interval numbers and windows and sorts selected weekdays", () => {
  const interval = { ...draft, repeat: "interval" as const };
  for (const every of ["", "0", "1.5", "40000000"]) {
    expect(buildTrigger({ ...interval, every, unit: "second" }, now)).toEqual({
      problem: "every",
    });
  }
  expect(
    buildTrigger({ ...interval, hasWindow: true, windowStart: "25:00" }, now),
  ).toEqual({ problem: "window" });
  expect(
    buildTrigger(
      { ...interval, every: " 2 ", weekdays: [5, 1], hasWindow: true },
      now,
    ),
  ).toEqual({
    value: {
      type: "interval",
      every: 2,
      unit: "minute",
      timeZone: "UTC",
      weekdays: [1, 5],
      window: { start: "08:00", end: "18:00" },
    },
  });
  expect(
    buildTrigger({ ...interval, weekdays: [1, 2, 3, 4, 5, 6, 7] }, now),
  ).toEqual({
    value: { type: "interval", every: 15, unit: "minute", timeZone: "UTC" },
  });
});

it("validates weekly times and emits sorted days and times", () => {
  const weekly = {
    ...draft,
    repeat: "interval" as const,
    intervalMode: "weekly" as const,
  };
  expect(buildTrigger({ ...weekly, weekdays: [] }, now)).toEqual({
    problem: "weekdays",
  });
  for (const times of [[], ["bad"], ["08:00", " 08:00 "]]) {
    expect(buildTrigger({ ...weekly, times }, now)).toEqual({
      problem: "times",
    });
  }
  expect(
    buildTrigger(
      {
        ...weekly,
        weekdays: [7, 2],
        times: [" 17:00 ", "08:00"],
        hasWindow: true,
      },
      now,
    ),
  ).toEqual({
    value: {
      type: "weekly",
      weekdays: [2, 7],
      times: ["08:00", "17:00"],
      timeZone: "UTC",
      window: { start: "08:00", end: "18:00" },
    },
  });
});

it("builds plan and ticket event filters", () => {
  const event = { ...draft, triggerKind: "event" as const };
  expect(
    buildTrigger(
      { ...event, eventType: "plan.step_changed", stepId: "step" },
      now,
    ),
  ).toEqual({
    value: {
      type: "event",
      eventType: "plan.step_changed",
      planId: null,
      stepId: null,
    },
  });
  expect(
    buildTrigger(
      {
        ...event,
        eventType: "plan.step_changed",
        planId: "plan",
        stepId: "step",
      },
      now,
    ),
  ).toEqual({
    value: {
      type: "event",
      eventType: "plan.step_changed",
      planId: "plan",
      stepId: "step",
    },
  });
  expect(buildTrigger(event, now)).toEqual({
    value: { type: "event", eventType: "plan.failed", planId: null },
  });
  expect(
    buildTrigger({ ...event, eventType: "ticket.created", projectId: "" }, now),
  ).toEqual({ problem: "project" });
  expect(
    buildTrigger({ ...event, eventType: "ticket.status_changed" }, now),
  ).toEqual({
    value: {
      type: "event",
      eventType: "ticket.status_changed",
      projectId: "project",
      statusId: null,
    },
  });
  expect(buildTrigger({ ...event, eventType: "ticket.created" }, now)).toEqual({
    value: {
      type: "event",
      eventType: "ticket.created",
      projectId: "project",
    },
  });
});

it("validates agent and plan actions", () => {
  expect(buildAction({ ...draft, agentId: "" }, options)).toEqual({
    problem: "agent",
  });
  expect(buildAction(draft, options)).toEqual({ problem: "instruction" });
  expect(buildAction({ ...draft, instruction: " Do it " }, options)).toEqual({
    value: { type: "agent", agentId: "agent", instruction: " Do it " },
  });
  expect(
    buildAction({ ...draft, actionType: "plan", actionPlanId: "" }, options),
  ).toEqual({ problem: "plan" });
  expect(buildAction({ ...draft, actionType: "plan" }, options)).toEqual({
    value: { type: "plan", planId: "plan" },
  });
});

it("validates script fields and includes forwarding only when selected", () => {
  const script = {
    ...draft,
    actionType: "script" as const,
    content: "echo hi",
  };
  expect(buildAction({ ...script, workspaceId: "" }, options)).toEqual({
    problem: "workspace",
  });
  expect(buildAction({ ...script, interpreterProfileId: "" }, options)).toEqual(
    { problem: "interpreter" },
  );
  expect(buildAction({ ...script, content: " " }, options)).toEqual({
    problem: "content",
  });
  for (const timeoutSeconds of ["x", "0", "61"])
    expect(buildAction({ ...script, timeoutSeconds }, options)).toEqual({
      problem: "timeout",
    });
  expect(buildAction(script, options)).toEqual({
    value: {
      type: "script",
      workspaceId: "workspace",
      interpreterProfileId: "shell",
      content: "echo hi",
      timeoutSeconds: 30,
      forward: null,
    },
  });
  expect(
    buildAction(
      { ...script, forwardAgentId: "agent", forwardWhen: "always" },
      options,
    ),
  ).toEqual({
    value: {
      type: "script",
      workspaceId: "workspace",
      interpreterProfileId: "shell",
      content: "echo hi",
      timeoutSeconds: 30,
      forward: { agentId: "agent", when: "always" },
    },
  });
});

it("builds creation payloads and returns the first invalid field", () => {
  const valid = {
    ...draft,
    name: " Job ",
    instruction: "Run",
    deleteAfterSuccess: true,
    sharing: "group:team",
  };
  expect(buildCreatePayload(draft, context)).toEqual({ problem: "name" });
  expect(buildCreatePayload({ ...valid, time: "bad" }, context)).toEqual({
    problem: "time",
  });
  expect(buildCreatePayload({ ...valid, instruction: "" }, context)).toEqual({
    problem: "instruction",
  });
  expect(
    buildCreatePayload(
      { ...valid, notificationMode: "error", notificationAgentId: "" },
      context,
    ),
  ).toEqual({ problem: "notificationAgent" });
  expect(buildCreatePayload(valid, context)).toEqual({
    value: {
      operationId: "operation",
      name: "Job",
      trigger: {
        type: "once",
        at: "2026-01-02T09:00:00+00:00",
        timeZone: "UTC",
      },
      action: { type: "agent", agentId: "agent", instruction: "Run" },
      sharing: { scope: "group", groupId: "team" },
      isActive: true,
      deleteAfterSuccess: true,
      agentNotification: { mode: "off" },
    },
  });
});

it("omits unchanged triggers and unreadable script content in updates", () => {
  const original = {
    ...draft,
    name: "Saved",
    triggerKind: "manual" as const,
    actionType: "script" as const,
    content: null,
  };
  expect(buildUpdatePayload(original, original, automation, context)).toEqual({
    value: {
      operationId: "operation",
      automationId: "automation",
      expectedRevision: 4,
      name: "Saved",
      sharing: { scope: "private" },
      deleteAfterSuccess: false,
      agentNotification: { mode: "off" },
    },
  });
  expect(
    buildUpdatePayload(
      {
        ...original,
        triggerKind: "event",
        isActive: false,
        notificationMode: "always",
        notificationAgentId: "agent",
      },
      original,
      automation,
      context,
    ),
  ).toEqual({
    value: {
      operationId: "operation",
      automationId: "automation",
      expectedRevision: 4,
      name: "Saved",
      trigger: { type: "event", eventType: "plan.failed", planId: null },
      sharing: { scope: "private" },
      isActive: false,
      deleteAfterSuccess: false,
      agentNotification: { mode: "always", agentId: "agent" },
    },
  });
});

it("reports invalid update fields before constructing an update", () => {
  const valid = { ...draft, name: "Job", instruction: "Run" };
  expect(
    buildUpdatePayload({ ...valid, name: " " }, valid, automation, context),
  ).toEqual({ problem: "name" });
  expect(
    buildUpdatePayload({ ...valid, time: "bad" }, valid, automation, context),
  ).toEqual({ problem: "time" });
  expect(
    buildUpdatePayload(
      { ...valid, instruction: "" },
      valid,
      automation,
      context,
    ),
  ).toEqual({ problem: "instruction" });
  expect(
    buildUpdatePayload(
      { ...valid, notificationMode: "error", notificationAgentId: "" },
      valid,
      automation,
      context,
    ),
  ).toEqual({ problem: "notificationAgent" });
});

it("validates weekly windows and preserves a selected ticket status", () => {
  const weekly = {
    ...draft,
    repeat: "interval" as const,
    intervalMode: "weekly" as const,
    hasWindow: true,
    windowEnd: "invalid",
  };
  expect(buildTrigger(weekly, now)).toEqual({ problem: "window" });
  expect(
    buildTrigger(
      {
        ...draft,
        triggerKind: "event",
        eventType: "ticket.status_changed",
        statusId: "done",
      },
      now,
    ),
  ).toEqual({
    value: {
      type: "event",
      eventType: "ticket.status_changed",
      projectId: "project",
      statusId: "done",
    },
  });
});
