import { expect, it } from "vitest";

import {
  isStepStatus,
  readPlanStepResult,
} from "@/backend/agents/AgentPlanStepResultInput";

import { agentErrorCode } from "./agent-error-code";
import {
  DIGEST,
  SCRIPT_RUN,
  UUID,
  sessionRecord,
  stepResult,
} from "./agent-plan-record-fixture";

import type { RecordFields } from "./agent-plan-record-fixture";

const EXECUTION = {
  schemaVersion: 1,
  planId: "plan",
  runId: "run",
  stepId: "s1",
  attemptId: UUID,
  planRevision: 1,
  target: { kind: "local" },
  workspace: { id: "w", path: "/work", revision: 1 },
  modelAccess: {
    connectionId: null,
    connectionName: "Codex",
    provider: "codex_cli",
    model: "gpt-5",
    reasoningEffort: null,
  },
};

const REMOTE = {
  jobId: UUID,
  sessionId: UUID,
  status: "completed",
  startedAt: null,
  endedAt: null,
  closeout: "confirmed",
};

it("reads a node result without optional parts", () => {
  expect(readPlanStepResult(stepResult())).toEqual({
    id: "s1",
    name: "Step",
    status: "succeeded",
    cancellation: "none",
    isBlocked: false,
    output: "done",
    error: null,
    session: null,
  });
});

it.each([true, false])(
  "preserves the display filtering flag %s",
  (displayFiltered) => {
    expect(
      readPlanStepResult(stepResult({ isDisplayFiltered: displayFiltered })),
    ).toMatchObject({ isDisplayFiltered: displayFiltered });
  },
);

it("reads every optional part of a node result", () => {
  expect(
    readPlanStepResult(
      stepResult({
        output: null,
        error: "failed",
        groupId: "g",
        failedStepId: "f",
        assetFailure: { id: "a", name: "file", cause: "missing" },
        resourceAccess: {
          files: [
            {
              parameter: "p",
              name: "f",
              type: "text/plain",
              size: 1,
              digest: DIGEST,
            },
          ],
          pages: "closed",
          events: [],
        },
        remote: REMOTE,
        execution: EXECUTION,
        session: sessionRecord(),
        script: SCRIPT_RUN,
        progress: { source: "live", observedAt: "now", todos: [] },
      }),
    ),
  ).toMatchObject({
    output: null,
    error: "failed",
    groupId: "g",
    failedStepId: "f",
    assetFailure: { cause: "missing" },
    resourceAccess: { pages: "closed" },
    remote: { status: "completed" },
    execution: { stepId: "s1" },
    session: { runner: "codex_cli" },
    script: { processId: 42 },
    progress: { source: "live", todos: [] },
  });
});

it.each<[string, RecordFields]>([
  ["an unknown status", { status: "done" }],
  ["an unknown cancellation", { cancellation: "maybe" }],
  ["a blocked flag that is no boolean", { isBlocked: 1 }],
  ["a display filtering flag that is no boolean", { isDisplayFiltered: 1 }],
  ["an output that is no text", { output: 1 }],
  ["an error that is no text", { error: {} }],
  ["an invalid script record", { script: { ...SCRIPT_RUN, uid: -1 } }],
])("refuses a node result with %s", (scenario, change) => {
  expect(agentErrorCode(() => readPlanStepResult(stepResult(change)))).toBe(
    "plan_invalid",
  );
});

it.each(["requested", "confirmed", "not_started"])(
  "accepts the cancellation %s",
  (cancellation) => {
    expect(readPlanStepResult(stepResult({ cancellation }))).toMatchObject({
      cancellation,
    });
  },
);

it("knows the persisted node statuses", () => {
  expect(isStepStatus("paused")).toBe(true);
  expect(isStepStatus("unknown")).toBe(false);
  expect(isStepStatus(1)).toBe(false);
});
