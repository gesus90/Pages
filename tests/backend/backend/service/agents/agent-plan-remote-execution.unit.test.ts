import { expect, it, vi } from "vitest";
import { localPlanModelSteps } from "@/backend/service/agents/AgentPlanRemoteExecution";
import {
  controlledRemoteService,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";
import { remoteTodoStep } from "./page162-remote-fixture";

it("returns cancellation before dispatch for an already aborted remote attempt", async () => {
  const world = await remoteCompletion(false);
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a remote step");
  const { service } = controlledRemoteService(world, "output");
  const controller = new AbortController();
  controller.abort();
  await expect(
    service.run(world.run, remote, controller.signal),
  ).resolves.toMatchObject({ status: "cancelled" });
});

it("rejects a changed target or missing attempt before dispatch", async () => {
  const world = await remoteCompletion(false);
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a remote step");
  const { service } = controlledRemoteService(world, "output");
  const signal = new AbortController().signal;
  await expect(
    service.run(
      world.run,
      { ...remote, target: { ...remote.target, path: "/changed" } },
      signal,
    ),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  await expect(
    service.run({ ...world.run, steps: [] }, remote, signal),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
});

it("keeps local models and requires validation for remote models", async () => {
  const world = await remoteCompletion(false);
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote || remote.step.type !== "agent")
    throw new Error("Expected an agent step");
  const local = { ...remoteTodoStep(), id: "local", configuration: undefined };
  const plan = {
    ...world.snapshot.plan,
    nodes: [local, remote.step],
    edges: [],
  };
  await expect(
    localPlanModelSteps(undefined, "user", plan),
  ).rejects.toMatchObject({ code: "plan_remote_unavailable" });
  const { service } = controlledRemoteService(world, "output");
  const validate = vi.mocked(service.validateModel);
  await expect(localPlanModelSteps(service, "user", plan)).resolves.toEqual([
    local,
  ]);
  expect(validate).toHaveBeenCalledWith(
    "user",
    { projectId: plan.projectId },
    remote.step,
  );
});

it("preserves remote progress when the runner has no matching job", async () => {
  const world = await remoteCompletion(false);
  const { service } = controlledRemoteService(world, "output");
  await expect(service.withProgress(world.run)).resolves.toEqual(world.run);
});
