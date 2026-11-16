import { expect, it } from "vitest";

import {
  describePlanIssue,
  planRetryNotice,
} from "@/backend/service/agents/AgentPlanRetryNotice";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";

it("describes actionable acceptance findings while preserving unknown codes", () => {
  expect(describePlanIssue("report_missing")).toContain(
    "neither called report_step_result",
  );
  expect(describePlanIssue("todo_open:one")).toContain("still open");
  expect(describePlanIssue("custom_code")).toBe("custom_code");
});

it("includes prior progress when retrying in a new session", () => {
  const retry = partial<AgentPlanRetry>({
    failureClass: "functional",
    attempts: [
      {
        code: "problem",
        failureClass: "functional",
        issues: ["report_missing"],
      },
    ],
  });
  const notice = planRetryNotice(retry, false, [
    { id: "todo", status: "active" },
  ]);
  expect(notice).toContain("does not remember the earlier conversation");
  expect(notice).toContain("todo: active");
  expect(notice).toContain("report_missing");
  expect(planRetryNotice(retry, true)).toContain(
    "continues the earlier native session",
  );
});

it("omits acceptance findings for a technical failure", () => {
  const retry = partial<AgentPlanRetry>({
    failureClass: "infrastructure",
    attempts: [
      {
        code: "offline",
        failureClass: "infrastructure",
        issues: ["report_missing"],
      },
    ],
  });
  const notice = planRetryNotice(retry, true);
  expect(notice).toContain("technical session error");
  expect(notice).not.toContain("report_missing");
  expect(planRetryNotice(partial<AgentPlanRetry>({ attempts: [] }), true)).toBe(
    "",
  );
});
