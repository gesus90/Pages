import { expect, it } from "vitest";

import {
  lastRunText,
  runSummaryText,
  runTone,
} from "@/app/components/automations/automation-run-summary";
import { createI18n } from "@/app/lib/i18n";

import { automation, now } from "./automation-fixture";

import type {
  Automation,
  AutomationRunResult,
  AutomationRunSummary,
} from "@/definition/Automation";

const t = createI18n("en").t;
const context = {
  t,
  now,
  timeZone: "UTC",
  language: "en",
  names: { agent: "Ada" },
};
const result: AutomationRunResult = {
  outcome: "ok",
  exitCode: null,
  forward: null,
  planRunId: null,
  planRunStatus: null,
  paused: false,
  errorCode: null,
  summary: null,
};
const run: AutomationRunSummary = {
  runId: "run",
  automationId: "automation",
  automationName: "Job",
  queuedAt: "2026-01-01T00:00:00Z",
  startedAt: null,
  endedAt: null,
  trigger: { kind: "manual" },
  status: "completed",
  result,
  duration: null,
};

function summary(
  current: AutomationRunSummary,
  selected: Automation | undefined = automation,
  place: "panel" | "history" = "panel",
): string {
  return runSummaryText({ run: current, automation: selected, place }, context);
}

it("assigns tones for pending, missing results, failures and forwarded scripts", () => {
  expect(runTone(null)).toBe("none");
  expect(runTone({ ...run, status: "queued" })).toBe("running");
  expect(runTone({ ...run, result: null })).toBe("ok");
  expect(runTone({ ...run, status: "failed", result: null })).toBe("error");
  expect(runTone({ ...run, result: { ...result, outcome: "skipped" } })).toBe(
    "warning",
  );
  expect(
    runTone({ ...run, result: { ...result, exitCode: 1, forward: "woken" } }),
  ).toBe("warning");
  expect(runTone({ ...run, result: { ...result, outcome: "failed" } })).toBe(
    "error",
  );
  expect(runTone(run)).toBe("ok");
});

it("distinguishes queued, waiting, running and missing final results", () => {
  expect(summary({ ...run, status: "queued" })).toBe(
    t("automations.runs.queued"),
  );
  expect(summary({ ...run, status: "accepted" })).toBe(
    t("automations.runs.waitingAgent"),
  );
  expect(summary({ ...run, status: "delivered" })).toBe(
    t("automations.runs.running"),
  );
  expect(summary({ ...run, status: "failed", result: null })).toBe(
    t("automations.runs.failed"),
  );
  expect(summary({ ...run, result: null })).toBe(t("automations.runs.ok"));
});

it("describes forbidden and skipped outcomes", () => {
  expect(
    summary({
      ...run,
      result: { ...result, outcome: "forbidden", paused: true },
    }),
  ).toBe(
    `${t("automations.runs.forbidden")} · ${t("automations.runs.paused")}`,
  );
  expect(summary({ ...run, result: { ...result, outcome: "forbidden" } })).toBe(
    t("automations.runs.forbidden"),
  );
  expect(
    summary({
      ...run,
      result: { ...result, outcome: "skipped", summary: "Busy" },
    }),
  ).toBe(`${t("automations.runs.skipped")} · Busy`);
  expect(summary({ ...run, result: { ...result, outcome: "skipped" } })).toBe(
    t("automations.runs.skipped"),
  );
});

it("describes script exit and forwarding, including an unknown agent", () => {
  expect(summary({ ...run, result: { ...result, exitCode: 0 } })).toBe(
    t("automations.runs.scriptOk"),
  );
  expect(
    summary({
      ...run,
      result: { ...result, exitCode: 2, forward: "not_woken" },
    }),
  ).toBe(
    `${t("automations.runs.scriptExit", { code: 2 })} · ${t("automations.runs.noAgentWoken")}`,
  );
  const script = {
    ...automation,
    action: {
      type: "script" as const,
      workspaceId: "w",
      interpreterProfileId: "i",
      content: "echo",
      timeoutSeconds: 1,
      forward: { agentId: "agent", when: "always" as const },
    },
  };
  expect(
    summary({ ...run, result: { ...result, forward: "woken" } }, script),
  ).toBe(
    `${t("automations.runs.scriptExit", { code: "?" })} · ${t("automations.runs.agentWoken", { agent: "Ada" })}`,
  );
  expect(summary({ ...run, status: "accepted" }, script)).toBe(
    t("automations.runs.running"),
  );
});

it("describes plan and agent results in panel and history", () => {
  const plan = {
    ...automation,
    action: { type: "plan" as const, planId: "plan" },
  };
  expect(summary(run, plan)).toBe(t("automations.runs.planNotStarted"));
  expect(summary({ ...run, result: { ...result, planRunId: "p" } }, plan)).toBe(
    t("automations.runs.planStarted"),
  );
  expect(
    summary(
      {
        ...run,
        result: { ...result, planRunId: "p", planRunStatus: "unusual" },
      },
      plan,
    ),
  ).toBe(
    `${t("automations.runs.planStarted")} · ${t("automations.runs.planRun.other", { status: "unusual" })}`,
  );
  expect(
    summary({
      ...run,
      result: { ...result, summary: "Report" },
      duration: 2000,
    }),
  ).toBe(`${t("automations.duration.seconds", { count: 2 })} · Report`);
  expect(summary(run, automation, "history")).toBe(
    `Ada · ${t("automations.runs.done")}`,
  );
  expect(
    summary({ ...run, result: { ...result, outcome: "failed" } }, undefined),
  ).toBe(t("automations.runs.failed"));
});

it("shows the last run's moment and outcome or duration", () => {
  expect(lastRunText(null, context)).toBe("—");
  expect(lastRunText({ ...run, status: "queued" }, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.runs.queued")}`,
  );
  expect(lastRunText({ ...run, status: "delivered" }, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.runs.running")}`,
  );
  expect(lastRunText({ ...run, status: "failed", result: null }, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.runs.failed")}`,
  );
  expect(lastRunText({ ...run, duration: 120000 }, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.duration.minutes", { count: 2 })}`,
  );
  expect(lastRunText(run, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.runs.ok")}`,
  );
});

it("uses the queued time when no start exists and handles failed forwarded scripts", () => {
  expect(
    runTone({
      ...run,
      result: { ...result, outcome: "failed", forward: "woken" },
    }),
  ).toBe("warning");
  expect(lastRunText({ ...run, result: null }, context)).toBe(
    `${t("automations.time.justNow")} · ${t("automations.runs.ok")}`,
  );
  expect(
    summary({ ...run, result: { ...result, forward: "woken" } }, undefined),
  ).toContain(t("automations.unknownName"));
});
