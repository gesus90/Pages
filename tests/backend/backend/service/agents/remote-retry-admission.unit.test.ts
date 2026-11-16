import { expect, it } from "vitest";

import { dispatchRemoteStepWithRetry } from "@/backend/service/agents/AgentPlanRemoteRetry";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { progressRun } from "./page162-progress-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

function active(
  hasRemote: boolean,
  status: "running" | "paused" = "running",
): ActivePlanRun {
  return partial<ActivePlanRun>({
    view: { ...progressRun(), status },
    snapshot: {
      steps: [],
      remoteSteps: hasRemote
        ? [
            {
              step: { id: "agent", type: "agent" },
              command: { program: { kind: "model" } },
            },
          ]
        : [],
    },
  });
}

it("leaves a local step to the local dispatcher and refuses missing remote dependencies", () => {
  const signal = new AbortController().signal;
  expect(
    dispatchRemoteStepWithRetry(undefined, active(false), "agent", signal),
  ).toBeNull();
  expect(() =>
    dispatchRemoteStepWithRetry(undefined, active(true), "agent", signal),
  ).toThrow("Remote execution is unavailable");
});

it("does not dispatch after cancellation or while paused", async () => {
  const controller = new AbortController();
  controller.abort();
  const dependencies = partial<
    NonNullable<Parameters<typeof dispatchRemoteStepWithRetry>[0]>
  >({});
  await expect(
    dispatchRemoteStepWithRetry(
      dependencies,
      active(true),
      "agent",
      controller.signal,
    ),
  ).resolves.toMatchObject({
    status: "cancelled",
    cancellation: "not_started",
  });
  await expect(
    dispatchRemoteStepWithRetry(
      dependencies,
      active(true, "paused"),
      "agent",
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: "paused" });
});
