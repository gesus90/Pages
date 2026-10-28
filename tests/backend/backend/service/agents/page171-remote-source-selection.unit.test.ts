import { expect, it, vi } from "vitest";

import { AgentPlanRemoteSources } from "@/backend/service/agents/AgentPlanRemoteSources";
import { remotePlanWorkspaceIds } from "@/backend/service/agents/AgentPlanExecutionTargets";

import { remoteCompletion } from "./page171-remote-acceptance-fixture";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanRemoteChoice } from "@/definition/AgentPlanTarget";

function choice(target: AgentPlanRemoteTarget): AgentPlanRemoteChoice {
  return {
    workspaceId: target.workspaceId,
    workspaceName: target.workspaceName,
    connectionName: target.connectionName,
    projectId: "project",
    path: target.path,
    isUsable: true,
    reason: null,
  };
}

async function sources(): Promise<{
  readonly service: AgentPlanRemoteSources;
  readonly targets: readonly AgentPlanRemoteTarget[];
  readonly availability: ReturnType<typeof vi.fn>;
  readonly catalog: ReturnType<typeof vi.fn>;
}> {
  const sample = await remoteCompletion(false);
  const initial = sample.snapshot.remoteSteps?.[0]?.target;
  if (!initial) throw new Error("Synthetic target is missing");
  const targets = [
    { ...initial, workspaceId: "selected", connectionId: "selected-runner" },
    { ...initial, workspaceId: "other", connectionId: "other-runner" },
  ];
  const availability = vi.fn(async () => null);
  const catalog = vi.fn(async () => undefined);
  const service = new AgentPlanRemoteSources({
    targets: {
      list: async () => targets,
      choices: async () => targets.map(choice),
    },
    runners: {
      availability,
      catalog,
      supportsPagesAccess: () => false,
      supportsOpenCode: () => false,
      supportsExactResultPayload: () => false,
    },
    provider: {
      catalog: async () => {
        throw new Error("Synthetic provider unavailable");
      },
    },
  });
  return { service, targets, availability, catalog };
}

it("checks only selected authorized workspaces when preparing a plan", async () => {
  const world = await sources();
  const result = await world.service.read("owner", "project", [
    "selected",
    "not-visible",
  ]);
  expect(result.statuses.map((status) => status.workspaceId)).toEqual([
    "selected",
  ]);
  expect(world.availability).toHaveBeenCalledExactlyOnceWith("selected-runner");
  expect(world.catalog).toHaveBeenCalledExactlyOnceWith("selected-runner");
});

it("still returns the full authorized catalog when no selection is requested", async () => {
  const world = await sources();
  const result = await world.service.read("owner", "project");
  expect(result.statuses.map((status) => status.workspaceId)).toEqual(
    world.targets.map((target) => target.workspaceId),
  );
  expect(world.availability).toHaveBeenCalledTimes(2);
});

it("includes inherited and explicit remote targets once when preparing a plan", async () => {
  const sample = await remoteCompletion(false);
  const step = sample.snapshot.remoteSteps?.[0]?.step;
  if (!step || step.type !== "agent")
    throw new Error("Synthetic agent is missing");
  const plan = {
    ...sample.snapshot.plan,
    executionTarget: { kind: "remote" as const, workspaceId: "inherited" },
    nodes: [
      { ...step, executionTarget: undefined },
      {
        ...step,
        id: "second",
        executionTarget: { kind: "remote" as const, workspaceId: "explicit" },
      },
      {
        ...step,
        id: "third",
        executionTarget: { kind: "remote" as const, workspaceId: "explicit" },
      },
    ],
  };
  expect(remotePlanWorkspaceIds(plan)).toEqual(["inherited", "explicit"]);
});
