import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { validatePlanReferences } from "@/backend/service/agents/AgentPlanReferences";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { partial } from "../../../app/lib/service-wiring-fakes";

it("saves a cleared ticket selection as a draft while reauthorizing every nonempty ticket", async () => {
  const snapshot = vi.fn(async () => ({
    id: "ticket",
    markdown: "Ticket",
    version: "1",
  }));
  const dependencies: Parameters<typeof validatePlanReferences>[0] = {
    profiles: partial({
      catalog: async () => [],
      isVisible: async () => false,
    }),
    parameters: partial({}),
    tasks: { snapshot },
    workspaces: partial({}),
  };
  const plan = {
    ...emptyAgentPlan(),
    nodes: [{ id: "ticket", type: "task" as const, taskId: "", x: 0, y: 0 }],
    edges: [],
  };
  await validatePlanReferences(dependencies, "copier", plan, "project");
  expect(snapshot).not.toHaveBeenCalled();
  const selected = {
    ...plan,
    nodes: [
      { id: "ticket", type: "task" as const, taskId: "selected", x: 0, y: 0 },
    ],
  };
  await validatePlanReferences(dependencies, "copier", selected, "project");
  expect(snapshot).toHaveBeenCalledWith("copier", "project", "selected");
  snapshot.mockRejectedValueOnce(new AgentError("plan_binding_invalid"));
  await expect(
    validatePlanReferences(dependencies, "copier", selected, "project"),
  ).rejects.toMatchObject({ code: "plan_binding_invalid" });
});
