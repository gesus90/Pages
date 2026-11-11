import { expect, it } from "vitest";

import {
  actionLine,
  eventKey,
  eventLabel,
  nameOf,
  runTriggerChip,
  triggerChip,
  triggerText,
  weekdaysLabel,
} from "@/app/components/automations/automation-labels";
import { createI18n } from "@/app/lib/i18n";

import { automation, now } from "./automation-fixture";

import type { AutomationRunSummary } from "@/definition/Automation";

const t = createI18n("en").t;
const context = {
  t,
  now,
  timeZone: "UTC",
  language: "en",
  names: { agent: "Ada", status: "Done", plan: "Launch" },
};
const run: AutomationRunSummary = {
  runId: "run",
  automationId: "automation",
  automationName: "Job",
  queuedAt: "2026-01-01T00:00:00Z",
  startedAt: null,
  endedAt: null,
  trigger: { kind: "manual" },
  status: "queued",
  result: null,
  duration: null,
};

it("names references and formats sorted, distinct weekday selections", () => {
  expect(nameOf(context, "agent")).toBe("Ada");
  expect(nameOf(context, "missing")).toBe(t("automations.unknownName"));
  expect(nameOf(context, null)).toBe(t("automations.unknownName"));
  expect(weekdaysLabel(t, [7, 6, 5, 4, 3, 2, 1])).toBe(
    t("automations.schedule.daily"),
  );
  expect(weekdaysLabel(t, [3, 1, 2, 2])).toBe(
    t("automations.schedule.range", {
      from: t("automations.weekdays.short.1"),
      to: t("automations.weekdays.short.3"),
    }),
  );
  expect(weekdaysLabel(t, [3, 1])).toBe(
    `${t("automations.weekdays.short.1")}, ${t("automations.weekdays.short.3")}`,
  );
  expect(weekdaysLabel(t, [])).toBe("");
});

it("renders trigger chips and event status names", () => {
  expect(triggerChip({ type: "manual" }, context)).toEqual({
    glyph: "▷",
    text: t("automations.trigger.manual"),
    tone: "plain",
  });
  expect(
    triggerText({ type: "once", at: null, timeZone: "UTC" }, context),
  ).toBe(t("automations.trigger.onceWithoutTime"));
  expect(
    triggerText(
      { type: "once", at: "2026-01-02T09:30:00Z", timeZone: "UTC" },
      context,
    ),
  ).toContain("09:30");
  expect(
    triggerText(
      { type: "interval", every: 2, unit: "hour", timeZone: "UTC" },
      context,
    ),
  ).toBe(t("automations.interval.hour", { count: 2 }));
  expect(
    triggerText(
      {
        type: "interval",
        every: 2,
        unit: "hour",
        timeZone: "UTC",
        weekdays: [1, 3],
      },
      context,
    ),
  ).toContain(weekdaysLabel(t, [1, 3]));
  expect(
    triggerText(
      {
        type: "weekly",
        weekdays: [1, 2, 3],
        times: ["08:00"],
        timeZone: "UTC",
      },
      context,
    ),
  ).toContain("08:00");
  expect(eventKey("plan.failed")).toBe("plan_failed");
  expect(
    eventLabel(context, {
      eventType: "ticket.status_changed",
      statusId: "status",
    }),
  ).toBe(t("automations.events.ticketToStatus", { status: "Done" }));
  expect(
    triggerChip(
      { type: "event", eventType: "plan.failed", planId: null },
      context,
    ),
  ).toEqual({
    glyph: "⚡",
    text: t("automations.events.plan_failed"),
    tone: "event",
  });
});

it("describes history triggers using the event and the visible automation", () => {
  for (const kind of ["manual", "once", "interval"] as const) {
    expect(
      runTriggerChip({ ...run, trigger: { kind } }, undefined, context).text,
    ).toBe(t(`automations.trigger.${kind}`));
  }
  const weekly = { ...run, trigger: { kind: "weekly" as const } };
  expect(runTriggerChip(weekly, undefined, context).text).toBe(
    t("automations.trigger.weekly"),
  );
  expect(runTriggerChip(weekly, automation, context).text).toBe(
    t("automations.trigger.manual"),
  );
  const event = {
    ...run,
    trigger: {
      kind: "event" as const,
      eventType: "ticket.status_changed" as const,
      subject: "PAGE-1",
    },
  };
  const eventAutomation = {
    ...automation,
    trigger: {
      type: "event" as const,
      eventType: "ticket.status_changed" as const,
      projectId: "project",
      statusId: "status",
    },
  };
  expect(runTriggerChip(event, eventAutomation, context).text).toBe(
    `${t("automations.events.ticketToStatus", { status: "Done" })} · PAGE-1`,
  );
  expect(
    runTriggerChip({ ...run, trigger: { kind: "event" } }, undefined, context)
      .text,
  ).toBe(t("automations.events.plan_failed"));
});

it("describes agent, plan and script actions", () => {
  expect(actionLine(automation.action, context)).toBe(
    t("automations.action.agent", { agent: "Ada" }),
  );
  expect(actionLine({ type: "plan", planId: "plan" }, context)).toBe(
    t("automations.action.plan", { plan: "Launch" }),
  );
  const script = {
    type: "script" as const,
    workspaceId: "w",
    interpreterProfileId: "i",
    content: "echo",
    timeoutSeconds: 1,
    forward: null,
  };
  expect(actionLine(script, context)).toBe(t("automations.action.script"));
  expect(
    actionLine(
      { ...script, forward: { agentId: "agent", when: "nonzero" } },
      context,
    ),
  ).toBe(t("automations.action.scriptForward.nonzero", { agent: "Ada" }));
});
