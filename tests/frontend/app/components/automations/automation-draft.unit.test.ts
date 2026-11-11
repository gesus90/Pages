import { expect, it } from "vitest";

import {
  draftFromAutomation,
  emptyDraft,
  sharingFromValue,
  sharingValue,
} from "@/app/components/automations/automation-draft";

import { automation, now, options } from "./automation-fixture";

it("chooses available defaults and handles empty choices", () => {
  expect(emptyDraft(options, now)).toMatchObject({
    date: "2026-01-02",
    time: "09:00",
    agentId: "agent",
    notificationAgentId: "agent",
    projectId: "project",
    actionPlanId: "plan",
    workspaceId: "workspace",
    interpreterProfileId: "shell",
    timeoutSeconds: "30",
  });
  expect(
    emptyDraft(
      {
        ...options,
        agents: [],
        plans: [],
        projects: [],
        workspaces: [],
        interpreterProfiles: [],
      },
      now,
    ),
  ).toMatchObject({
    agentId: "",
    notificationAgentId: "",
    projectId: "",
    actionPlanId: "",
    workspaceId: "",
    interpreterProfileId: "",
  });
});

it("round trips sharing selections", () => {
  expect(sharingValue({ scope: "private" })).toBe("private");
  expect(sharingValue({ scope: "project", projectId: "p" })).toBe("project:p");
  expect(sharingValue({ scope: "group", groupId: "g" })).toBe("group:g");
  expect(sharingFromValue("project:p")).toEqual({
    scope: "project",
    projectId: "p",
  });
  expect(sharingFromValue("group:g")).toEqual({
    scope: "group",
    groupId: "g",
  });
  expect(sharingFromValue("unknown")).toEqual({ scope: "private" });
});

it("restores once and interval triggers, including their optional window", () => {
  expect(
    draftFromAutomation(
      {
        ...automation,
        trigger: {
          type: "once",
          at: "2026-02-02T10:30:00Z",
          timeZone: "UTC",
        },
      },
      options,
      now,
    ),
  ).toMatchObject({
    triggerKind: "time",
    repeat: "once",
    date: "2026-02-02",
    time: "10:30",
  });
  expect(
    draftFromAutomation(
      {
        ...automation,
        trigger: {
          type: "interval",
          every: 3,
          unit: "hour",
          timeZone: "UTC",
        },
      },
      options,
      now,
    ),
  ).toMatchObject({
    repeat: "interval",
    intervalMode: "every",
    every: "3",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    hasWindow: false,
  });
  expect(
    draftFromAutomation(
      {
        ...automation,
        trigger: {
          type: "interval",
          every: 1,
          unit: "day",
          timeZone: "UTC",
          weekdays: [2],
          window: { start: "22:00", end: "02:00" },
        },
      },
      options,
      now,
    ),
  ).toMatchObject({
    weekdays: [2],
    hasWindow: true,
    windowStart: "22:00",
    windowEnd: "02:00",
  });
});

it("restores weekly and event filters", () => {
  expect(
    draftFromAutomation(
      {
        ...automation,
        trigger: {
          type: "weekly",
          weekdays: [1],
          times: ["11:00"],
          timeZone: "UTC",
        },
      },
      options,
      now,
    ),
  ).toMatchObject({
    intervalMode: "weekly",
    weekdays: [1],
    times: ["11:00"],
    hasWindow: false,
  });
  expect(
    draftFromAutomation(
      {
        ...automation,
        trigger: {
          type: "event",
          eventType: "plan.step_changed",
          planId: "plan",
          stepId: "step",
        },
      },
      options,
      now,
    ),
  ).toMatchObject({
    triggerKind: "event",
    eventType: "plan.step_changed",
    planId: "plan",
    stepId: "step",
    projectId: "",
    statusId: "",
  });
});

it("restores script, plan, sharing and notification fields", () => {
  expect(
    draftFromAutomation(
      {
        ...automation,
        action: {
          type: "script",
          workspaceId: "w",
          interpreterProfileId: "i",
          content: null,
          timeoutSeconds: 12,
          forward: { agentId: "a", when: "zero" },
        },
        sharing: { scope: "project", projectId: "p" },
        agentNotification: { mode: "error", agentId: "a" },
      },
      options,
      now,
    ),
  ).toMatchObject({
    actionType: "script",
    workspaceId: "w",
    interpreterProfileId: "i",
    content: null,
    timeoutSeconds: "12",
    forwardAgentId: "a",
    forwardWhen: "zero",
    sharing: "project:p",
    notificationMode: "error",
    notificationAgentId: "a",
  });
  expect(
    draftFromAutomation(
      { ...automation, action: { type: "plan", planId: "p" } },
      options,
      now,
    ),
  ).toMatchObject({
    triggerKind: "manual",
    actionType: "plan",
    actionPlanId: "p",
    notificationAgentId: "agent",
  });
});
