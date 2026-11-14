import { expect, it } from "vitest";

import { readPlanScriptRun } from "@/backend/agents/AgentPlanScriptRunInput";

import { agentErrorCode } from "./agent-error-code";
import { SCRIPT_RUN } from "./agent-plan-record-fixture";

it("reads a stored script process record", () => {
  expect(readPlanScriptRun(SCRIPT_RUN)).toEqual(SCRIPT_RUN);
});

it.each([
  { processId: 0 },
  { failure: "crash" },
  { stderr: null },
  { extra: true },
])("refuses a script record with %j", (change) => {
  expect(
    agentErrorCode(() => readPlanScriptRun({ ...SCRIPT_RUN, ...change })),
  ).toBe("plan_invalid");
});

it("retains disk scratch identity for interrupted script recovery", () => {
  const record = {
    ...SCRIPT_RUN,
    temporaryScope: { runId: SCRIPT_RUN.instanceId, stepId: "script-check" },
  };
  expect(readPlanScriptRun(record)).toEqual(record);
});
