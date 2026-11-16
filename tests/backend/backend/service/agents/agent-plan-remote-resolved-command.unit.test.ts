import { expect, it, vi } from "vitest";

import {
  requireRemoteResultPayload,
  resolvedRemoteCommand,
} from "@/backend/service/agents/AgentPlanRemoteResolvedCommand";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerExecution } from "@/definition/RunnerExecution";

it("requires the exact result protocol only for CLI commands", () => {
  const supports = vi.fn(() => false);
  expect(() =>
    requireRemoteResultPayload(
      partial<RunnerExecution>({ program: { kind: "script" } }),
      supports,
    ),
  ).not.toThrow();
  expect(supports).not.toHaveBeenCalled();
  expect(() =>
    requireRemoteResultPayload(
      partial<RunnerExecution>({
        program: { kind: "cli" },
        resultPayloadVersion: 1,
      }),
      supports,
    ),
  ).toThrow();
  expect(() =>
    requireRemoteResultPayload(
      partial<RunnerExecution>({
        program: { kind: "cli" },
        resultPayloadVersion: 1,
      }),
      () => true,
    ),
  ).not.toThrow();
});

it("binds only successful predecessor output into a script while preserving source revision", async () => {
  const run = partial<AgentPlanRun>({
    planRevision: 4,
    steps: [
      { id: "done", status: "succeeded", output: "answer" },
      { id: "failed", status: "failed", output: "secret" },
    ],
  });
  const remote = partial<RemotePlanStep>({
    inputs: { fixed: "value" },
    step: {
      type: "script",
      bindings: {
        first: { kind: "result", stepId: "done" },
        second: { kind: "result", stepId: "failed" },
      },
    },
    command: { revision: 2, program: { kind: "script" } },
  });
  await expect(resolvedRemoteCommand(run, remote)).resolves.toMatchObject({
    revision: 4,
    sourceRevision: 2,
    input: JSON.stringify({ fixed: "value", first: "answer", second: "" }),
  });
});

it("refuses a CLI command without an agent configuration", async () => {
  const remote = partial<RemotePlanStep>({
    inputs: {},
    step: { type: "agent", bindings: {} },
    command: { program: { kind: "cli" } },
  });
  await expect(
    resolvedRemoteCommand(partial<AgentPlanRun>({ steps: [] }), remote),
  ).rejects.toMatchObject({ code: "configuration_invalid" });
});
