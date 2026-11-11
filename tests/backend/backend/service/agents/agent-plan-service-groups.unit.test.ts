import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ACP_RUN_OPTIONS } from "@/definition/AgentConfiguration";

import {
  agentNode,
  groupNode,
  planInput,
} from "../../agents/agent-plan-input-fixture";
import {
  AGENT_ID,
  PROJECT_ID,
  WORKSPACE_ID,
  catalogAgent,
  createPlanContext,
} from "./agent-plan-service-harness";

vi.mock("@/backend/service/agents/AgentPlanControlService", () => ({
  AgentPlanControlService: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanStartActions", () => ({
  AgentPlanStartActions: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanReferences", () => ({
  validatePlanReferences: vi.fn(),
}));

interface ResolvedConnection {
  readonly assignment: {
    readonly connection: { readonly id: string; readonly provider: string };
  };
}

const START = { id: "start", x: 0, y: 0, type: "start" };
const END = { id: "end", x: 0, y: 0, type: "end" };

function groupInput(): object {
  return planInput({
    workspaceId: WORKSPACE_ID,
    nodes: [
      START,
      groupNode({ steps: [agentNode({ id: "m1" }), agentNode({ id: "m2" })] }),
      END,
    ],
    edges: [
      { from: "start", to: "g1" },
      { from: "g1", to: "end" },
    ],
  });
}

function connection(id: string, provider: string): ResolvedConnection {
  return { assignment: { connection: { id, provider } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentPlanService.save of a plan with groups", () => {
  it("prepares the execution of a group plan that has no execution issues", async () => {
    const { service, mocks } = createPlanContext();

    await service.save("owner", null, groupInput());

    expect(mocks.preparation.prepare).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
    expect(mocks.profiles.resolveDefinition).toHaveBeenCalledTimes(2);
    expect(mocks.plans.save).toHaveBeenCalledOnce();
  });

  it("does not prepare a group plan whose graph is not executable yet", async () => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.catalog.mockResolvedValue([]);

    await service.save("owner", null, groupInput());

    expect(mocks.preparation.prepare).not.toHaveBeenCalled();
    expect(mocks.plans.save).toHaveBeenCalledOnce();
  });

  it("refuses a group whose members run on different connections", async () => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.resolveDefinition
      .mockResolvedValueOnce(connection("connection-1", "codex_cli"))
      .mockResolvedValueOnce(connection("connection-2", "codex_cli"));

    await expect(
      service.save("owner", null, groupInput()),
    ).rejects.toMatchObject({
      issues: [
        { nodeId: "m2", port: "connectionId", reason: "groupConfiguration" },
      ],
    });
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("refuses a group whose members use different adapters", async () => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.resolveDefinition
      .mockResolvedValueOnce(connection("connection-1", "codex_cli"))
      .mockResolvedValueOnce(connection("connection-1", "claude_code"));

    await expect(
      service.save("owner", null, groupInput()),
    ).rejects.toMatchObject({
      issues: [
        {
          nodeId: "m2",
          port: "provider/adapter",
          reason: "groupProvider",
        },
      ],
    });
  });

  it("refuses a group member whose provider does not run in a shared ACP session", async () => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.resolveDefinition.mockResolvedValue(
      connection("connection-1", "openrouter"),
    );

    await expect(
      service.save("owner", null, groupInput()),
    ).rejects.toMatchObject({
      issues: [
        { nodeId: "m1", port: "provider/adapter", reason: "groupProvider" },
      ],
    });
  });
});

describe("AgentPlanService.save run options", () => {
  it("refuses run options the provider of the connection does not allow", async () => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.catalog.mockResolvedValue([
      catalogAgent(AGENT_ID, {
        configuration: {
          ...catalogAgent().configuration,
          run: { ...DEFAULT_ACP_RUN_OPTIONS, access: "workspace_write" },
        },
      }),
    ]);

    await expect(
      service.save("owner", null, planInput({ workspaceId: WORKSPACE_ID })),
    ).rejects.toMatchObject({
      code: "codex_permission_mode_required",
    });
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });
});
