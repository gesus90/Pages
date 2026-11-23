import { expect, it } from "vitest";

import {
  planScriptRunSchema,
  readPlanScriptRun,
} from "@/backend/agents/AgentPlanScriptRunInput";
import { AgentError } from "@/backend/error/AgentErrors";

const UUID = "11111111-1111-4111-8111-111111111111";

const RUN = {
  attemptId: UUID,
  instanceId: UUID,
  interpreterProfileId: "bash",
  directory: "/work",
  userId: "u",
  uid: 1000,
  gid: 1000,
  processId: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  exitCode: null,
  signal: null,
  failure: null,
  closeout: "pending",
  stdout: null,
  stderr: "",
};

it("returns a valid run record", () => {
  expect(readPlanScriptRun(RUN)).toEqual(RUN);
  expect(planScriptRunSchema.safeParse(RUN).success).toBe(true);
});

it("accepts the optional ownership fields", () => {
  const run = {
    ...RUN,
    runnerOwned: true,
    runnerJob: { connectionId: UUID, jobId: UUID, attemptId: UUID },
    temporaryScope: { runId: UUID, stepId: "s" },
    namespace: { pid: 1, uid: 0, start: 0, boot: UUID },
  };
  expect(readPlanScriptRun(run)).toEqual(run);
});

it("rejects malformed input as an invalid plan", () => {
  expect(() => readPlanScriptRun({ ...RUN, uid: -1 })).toThrow(AgentError);
  expect(() => readPlanScriptRun("x")).toThrow(AgentError);
  expect(() => readPlanScriptRun({ ...RUN, extra: 1 })).toThrow(AgentError);
});
