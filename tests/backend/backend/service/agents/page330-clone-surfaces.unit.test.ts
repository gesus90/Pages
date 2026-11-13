import { expect, it, vi } from "vitest";

import { AgentPlanCommandOperations } from "@/backend/service/agents/AgentPlanCommandOperations";
import { AgentPlanManagement } from "@/backend/service/agents/AgentPlanManagement";
import { clonePlanAction } from "@/app/lib/agent-plan-management.server";
import { action as cloneRoute } from "@/app/routes/api-mcp-v1-plan-clone";
import { PLAN_RESOURCE_WRITE_TOOLS } from "@/definition/AgentTools/PlanResources";
import { readAgentObject } from "@/backend/agents/AgentPayload";

import { CloneWorld } from "./agent-plan-cloning-fixture";
import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";

const { apiRun } = vi.hoisted(() => ({ apiRun: vi.fn() }));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  async () => ({
    AgentOperationKeyRepository: (await import("./agent-plan-command-fakes"))
      .FakeOperationKeyRepository,
  }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () => ({
  requirePlanRevision: vi.fn(async () => undefined),
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanAuditRepository",
  () => ({
    AgentPlanAuditRepository: class {
      public readonly append = vi.fn(async () => undefined);
    },
  }),
);
vi.mock("@/backend/service/agents/AgentPlanControlViews", () => ({
  readPlanControlEntry: async (
    plans: unknown,
    user: string,
    planId: string,
  ) => {
    void plans;
    void user;
    return { planId, status: "idle" };
  },
}));
vi.mock("@/app/lib/mcp-plan-route.server", () => ({
  mcpPlanBodyRequest: async (request: Request, path: object) => ({
    path,
    parameters: (await request.json()) as unknown,
  }),
  requireMcpPlanParameter: (parameter: string) => parameter,
  mcpPlanResponse: (body: unknown, status: number) =>
    Response.json(body, { status }),
  runMcpPlanRoute: async (request: Request, handlers: McpPlanHandlers) => {
    if (!handlers.POST) throw new Error("missing clone handler");
    return handlers.POST({
      api: partial({ run: apiRun }),
      identity: partial({}),
      request,
    });
  },
}));

it("repairs the same foreign-workspace/agent case through page, Pica command and the MCP route", async () => {
  const world = new CloneWorld();
  const database = {
    transaction: async <T>(
      work: (transaction: typeof world.transaction) => Promise<T>,
    ): Promise<T> => work(world.transaction),
  };
  const plans = partial<
    ConstructorParameters<typeof AgentPlanCommandOperations>[0]["plans"]
  >({
    clone: world.service.clone.bind(world.service),
    view: async () => world.source,
  });
  const management = new AgentPlanManagement({ database, plans });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    planId: "source",
    revision: "1",
    name: "",
    requestKey: "ui",
  }))
    form.set(key, value);
  const pageResponse = await clonePlanAction(
    "copier",
    partial({ agentPlanManagement: management }),
    form,
  );
  const page = readAgentObject((await pageResponse.json()) as unknown);
  const command = new AgentPlanCommandOperations({
    database,
    plans,
    templates: partial({}),
  });
  const pica = await command.write("copier", "plans.clone", {
    operationId: "pica",
    planId: "source",
    expectedRevision: 1,
    name: "",
  });
  apiRun.mockImplementation(
    async (
      _: unknown,
      operation: "plans.clone",
      request: { readonly path: object; readonly parameters: object },
    ) =>
      command.write("copier", operation, {
        ...request.path,
        ...request.parameters,
      }),
  );
  const request = new Request(
    "http://unit.invalid/api/mcp/v1/plans/source/clone",
    {
      method: "POST",
      body: JSON.stringify({
        operationId: "mcp",
        expectedRevision: 1,
        name: "",
      }),
    },
  );
  const response = await cloneRoute(
    partial({ request, params: { planId: "source" } }),
  );
  const mcp = readAgentObject((await response.json()) as unknown);
  expect(response.status).toBe(201);
  const adjustments = (index: number): unknown => [
    { code: "source_revision_updated" },
    { code: "workspace_replaced" },
    { code: "reference_cleared", nodeId: world.saved[index]?.nodes[0]?.id },
  ];
  expect(page.adjustments).toEqual(adjustments(0));
  expect(pica).toMatchObject({ adjustments: adjustments(1) });
  expect(mcp.adjustments).toEqual(adjustments(2));
  expect(world.saved).toHaveLength(3);
  expect(
    world.saved.every(
      (plan) => plan.workspaceId === "own" && plan.ownerId === "copier",
    ),
  ).toBe(true);
  const tool = PLAN_RESOURCE_WRITE_TOOLS.find(
    (entry) => entry.operation === "plans.clone",
  )?.tool;
  expect(tool?.name).toBe("clone_plan");
  expect(tool?.inputSchema.properties).toHaveProperty("teams");
  expect(tool?.inputSchema.properties).toHaveProperty("ownerId");
});
