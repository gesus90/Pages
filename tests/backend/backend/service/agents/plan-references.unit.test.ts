import { expect, it, vi } from "vitest";

import { validatePlanReferences } from "@/backend/service/agents/AgentPlanReferences";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanParameter } from "@/definition/AgentPlan";

function parameter(id: string, value: AgentParameterValue): AgentPlanParameter {
  return {
    id,
    type: "parameter",
    name: id,
    format: "string",
    value,
    x: 0,
    y: 0,
  };
}

it("reauthorizes ticket, wiki, asset and workspace values on save", async () => {
  const requireTicket = vi.fn(async () => undefined);
  const requireWiki = vi.fn(async () => undefined);
  const describe = vi.fn(async () => ({ projectId: "project" }));
  const resolve = vi.fn(async () => undefined);
  const dependencies: Parameters<typeof validatePlanReferences>[0] = {
    profiles: partial({ catalog: async () => [], isVisible: async () => true }),
    parameters: partial({ requireTicket, requireWiki }),
    tasks: partial({}),
    workspaces: partial({ resolve }),
    planAssets: partial({ describe }),
  };
  const plan = {
    ...emptyAgentPlan(),
    nodes: [
      parameter("ticket", { type: "ticket", ticketId: "t" }),
      parameter("wiki", { type: "wiki", pageId: "w" }),
      parameter("asset", { type: "asset", assetId: "a" }),
      parameter("workspace", { type: "workspace", workspaceId: "workspace" }),
    ],
  };
  await validatePlanReferences(dependencies, "user", plan, "project");
  expect(requireTicket).toHaveBeenCalledWith("user", "t");
  expect(requireWiki).toHaveBeenCalledWith("user", "w");
  expect(describe).toHaveBeenCalledWith("user", "a");
  expect(resolve).toHaveBeenCalledWith("user", "workspace", "project");
  describe.mockResolvedValueOnce({ projectId: "other" });
  await expect(
    validatePlanReferences(dependencies, "user", plan, "project"),
  ).rejects.toMatchObject({ code: "plan_asset_missing" });
});

it("refuses a personal agent whose visibility has been revoked", async () => {
  const dependencies: Parameters<typeof validatePlanReferences>[0] = {
    profiles: partial({
      catalog: async () => [],
      isVisible: async () => false,
    }),
    parameters: partial({}),
    tasks: partial({}),
    workspaces: partial({}),
  };
  const plan = {
    ...emptyAgentPlan(),
    nodes: [
      {
        id: "agent",
        type: "agent" as const,
        agentId: "agent",
        personalAgentId: "private",
        instruction: "",
        bindings: {},
        x: 0,
        y: 0,
      },
    ],
  };
  await expect(
    validatePlanReferences(dependencies, "user", plan, "project"),
  ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
});
