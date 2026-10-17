import { expect, it } from "vitest";

import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  attemptIdOf,
  describeSessionModel,
  listSessionAttempts,
  requireSessionAttempt,
  sessionStart,
} from "@/backend/service/agents/sessions/AgentSessionAttempts";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";

import {
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

const GROUP_RUN = sessionRun([
  sessionStep(
    "member-a",
    sessionRecord({ attemptId: "attempt-a", instanceId: "group-process" }),
    { groupId: "group" },
  ),
  sessionStep(
    "member-b",
    sessionRecord({ attemptId: "attempt-b", instanceId: "group-process" }),
    { groupId: "group" },
  ),
  sessionStep(
    "api",
    sessionRecord({ runner: "api", attemptId: "attempt-api" }),
  ),
]);

function denied(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error: unknown) {
    return error instanceof AgentError ? error.code : "unexpected";
  }
}

it("gives group members sharing one process their own attempts and skips API requests", () => {
  const attempts = listSessionAttempts(GROUP_RUN);
  expect(attempts.map((attempt) => attempt.key)).toEqual([
    {
      planId: "plan-1",
      runId: "run-1",
      stepId: "member-a",
      attemptId: "attempt-a",
    },
    {
      planId: "plan-1",
      runId: "run-1",
      stepId: "member-b",
      attemptId: "attempt-b",
    },
  ]);
  expect(
    new Set(attempts.map((attempt) => attempt.record.instanceId)).size,
  ).toBe(1);
  const start = sessionStart(
    {
      run: GROUP_RUN,
      step: { step: { id: "member-b" }, groupId: "group" },
      record: attempts[1]?.record ?? null,
    },
    "group-process",
  );
  expect(start).toMatchObject({
    key: { stepId: "member-b", attemptId: "attempt-b" },
    instanceId: "group-process",
    groupId: "group",
    provider: "claude_code",
  });
});

it("rejects keys of another run, plan, member or attempt", () => {
  const key = {
    planId: "plan-1",
    runId: "run-1",
    stepId: "member-a",
    attemptId: "attempt-a",
  };
  expect(requireSessionAttempt(GROUP_RUN, key).step.id).toBe("member-a");
  expect(
    denied(() => requireSessionAttempt(GROUP_RUN, { ...key, runId: "run-2" })),
  ).toBe("plan_access_denied");
  expect(
    denied(() =>
      requireSessionAttempt(GROUP_RUN, { ...key, planId: "plan-2" }),
    ),
  ).toBe("plan_access_denied");
  // Another member's attempt is not readable under this member, though both share the process.
  expect(
    denied(() =>
      requireSessionAttempt(GROUP_RUN, { ...key, attemptId: "attempt-b" }),
    ),
  ).toBe("plan_access_denied");
  expect(
    denied(() =>
      requireSessionAttempt(GROUP_RUN, {
        ...key,
        stepId: "api",
        attemptId: "attempt-api",
      }),
    ),
  ).toBe("plan_access_denied");
});

it("migrates older records compatibly: their attempt is derived and marked as legacy", () => {
  // A record stored before PAGE-85 has no attempt ID at all.
  const legacy = sessionRecord({ attemptId: undefined });
  const restored = readPlanSessionRecord(JSON.parse(JSON.stringify(legacy)));
  expect(restored?.attemptId).toBeUndefined();
  expect(restored && attemptIdOf(restored, "step-a")).toEqual({
    attemptId: "instance-1:step-a",
    isLegacy: true,
  });
  const current = readPlanSessionRecord(
    JSON.parse(JSON.stringify(sessionRecord())),
  );
  expect(current?.attemptId).toBe("attempt-1");
});

it("keeps the requested model apart from a confirmed one and never confirms an unknown model", () => {
  const record = sessionRecord();
  const unknown = describeSessionModel(record, null);
  expect(unknown.requestedModel).toEqual({
    value: "claude-opus-5-5",
    source: "plan",
    reportedAt: "2026-10-17T01:00:00.000Z",
  });
  expect(unknown.confirmedModel).toEqual({
    value: null,
    source: null,
    reportedAt: null,
  });
  const reported = describeSessionModel(record, {
    key: {
      planId: "plan-1",
      runId: "run-1",
      stepId: "step",
      attemptId: "attempt-1",
    },
    userId: "executor",
    provider: "claude_code",
    instanceId: "instance-1",
    groupId: null,
    state: "running",
    context: UNKNOWN_CONTEXT,
    confirmedModel: {
      value: "claude-opus-5-5-20261001",
      source: "acp_usage_report",
      reportedAt: "t2",
    },
    confirmedReasoning: { value: null, source: null, reportedAt: null },
    workspace: null,
    updatedAt: "t2",
  });
  expect(reported.confirmedModel.source).toBe("acp_usage_report");
  expect(reported.requestedModel.value).toBe("claude-opus-5-5");
  // OpenCode's default effort is filled in by Pages, so it is not confirmed.
  const openCode = describeSessionModel(
    sessionRecord({
      runner: "opencode",
      turnEndedAt: "t3",
      effective: { model: "anthropic/claude", reasoningEffort: "default" },
    }),
    null,
  );
  expect(openCode.confirmedModel).toEqual({
    value: "anthropic/claude",
    source: "adapter_selector",
    reportedAt: "t3",
  });
  expect(openCode.confirmedReasoning.value).toBeNull();
});
