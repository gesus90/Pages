import { expect, it, vi } from "vitest";
import {
  AgentPlanRemoteExecution,
  localPlanModelSteps,
} from "@/backend/service/agents/AgentPlanRemoteExecution";
import {
  controlledRemoteService,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";
import { partial } from "../../../app/lib/service-wiring-fakes";
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

it("stops only the original unconfirmed remote job", async () => {
  const world = await remoteCompletion(false);
  const progress = vi.fn(async () => world.job);
  const cancel = vi.fn(async () => undefined);
  const service = new AgentPlanRemoteExecution(
    partial({ runners: { progress, cancel } }),
  );
  await service.stop(world.run);
  expect(cancel).toHaveBeenCalledWith(world.connectionId, world.job.jobId);
  progress.mockResolvedValue({ ...world.job, plan: undefined });
  await service.stop(world.run);
  expect(cancel).toHaveBeenCalledOnce();
});

it("replays pause and resume for the original job and refuses unsupported control", async () => {
  const world = await remoteCompletion(false);
  const progress = vi.fn(async () => world.job);
  const pauseExecution = vi.fn(async () => undefined);
  const service = new AgentPlanRemoteExecution(
    partial({ runners: { progress, pauseExecution } }),
  );
  await service.pause(world.run);
  await service.resume(world.run);
  expect(pauseExecution.mock.calls).toEqual([
    [world.connectionId, world.job.jobId, true],
    [world.connectionId, world.job.jobId, false],
  ]);
  const unsupported = new AgentPlanRemoteExecution(
    partial({ runners: { progress } }),
  );
  await expect(unsupported.pause(world.run)).rejects.toMatchObject({
    code: "plan_runner_control_update_required",
  });
});

it("rejects changed remote routes before looking up a catalog", async () => {
  const world = await remoteCompletion(false);
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote || remote.step.type !== "agent" || !remote.step.configuration)
    throw new Error("Expected a remote agent");
  const service = new AgentPlanRemoteExecution(partial({}));
  const sources = vi.spyOn(service, "sources");
  const plan = { projectId: world.snapshot.plan.projectId };
  await expect(
    service.validateModel("user", plan, {
      ...remote.step,
      executionTarget: undefined,
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  await expect(
    service.validateModel("user", plan, {
      ...remote.step,
      configuration: { ...remote.step.configuration, connectionId: "local" },
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  expect(sources).not.toHaveBeenCalled();
});

it("refuses a remote model absent from the current catalog", async () => {
  const world = await remoteCompletion(false);
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote || remote.step.type !== "agent")
    throw new Error("Expected a remote agent");
  const configuration = remote.step.configuration;
  if (!configuration?.runnerRoute) throw new Error("Expected a runner route");
  const step = {
    ...remote.step,
    configuration: {
      ...configuration,
      runnerRoute: {
        ...configuration.runnerRoute,
        workspaceId: remote.target.workspaceId,
      },
    },
  };
  const service = new AgentPlanRemoteExecution(partial({}));
  vi.spyOn(service, "sources").mockResolvedValue({
    models: [],
    interpreters: [],
    statuses: [],
  });
  await expect(
    service.validateModel(
      "user",
      { projectId: world.snapshot.plan.projectId },
      step,
    ),
  ).rejects.toMatchObject({ code: "plan_remote_unavailable" });
});
