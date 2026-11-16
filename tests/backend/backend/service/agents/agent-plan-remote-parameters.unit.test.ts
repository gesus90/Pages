import { expect, it, vi } from "vitest";

import { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { RemotePlanParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";

const TARGET = partial<AgentPlanRemoteTarget>({
  workspaceId: "workspace",
  connectionId: "connection",
  path: "/work",
});
const PREPARED = partial<RemotePlanParameters>({
  values: {},
  tickets: {},
  wiki: {},
  workspaces: {},
  resources: [],
  assets: [],
});

it("prepares an empty parameter set and rejects a missing template", async () => {
  const service = new AgentPlanRemoteParameters(partial({}));
  const plan = partial<AgentPlan>({ projectId: "project" });
  const step = partial<AgentPlanStep>({
    id: "step",
    instruction: "Work",
    bindings: {},
    configuration: { template: { markdown: "Instructions", parameters: [] } },
  });
  await expect(
    service.prepare("user", { plan, step, tasks: [], target: TARGET }),
  ).resolves.toEqual(PREPARED);
  await expect(
    service.prepare("user", {
      plan,
      step: partial<AgentPlanStep>({}),
      tasks: [],
      target: TARGET,
    }),
  ).rejects.toMatchObject({ code: "configuration_invalid" });
});

it("rechecks the exact pinned workspace against current permissions", async () => {
  const list = vi.fn(async () => [TARGET]);
  const service = new AgentPlanRemoteParameters(partial({ targets: { list } }));
  await expect(
    service.authorize("user", PREPARED, {
      projectId: "project",
      target: TARGET,
    }),
  ).resolves.toBeUndefined();
  await expect(
    service.authorize("user", PREPARED, {
      projectId: "project",
      target: { ...TARGET, path: "/changed" },
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  expect(list).toHaveBeenCalledWith("user", "project");
});
