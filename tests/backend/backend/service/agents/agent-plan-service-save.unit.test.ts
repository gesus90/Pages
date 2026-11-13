import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { agentNode, planInput } from "../../agents/agent-plan-input-fixture";
import {
  AGENT_ID,
  PROJECT_ID,
  WORKSPACE_ID,
  catalogAgent,
  createPlanContext,
  planView,
  stub,
} from "./agent-plan-service-harness";

import type { PlanContext } from "./agent-plan-service-harness";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";

const boundary = vi.hoisted(() => ({
  references: vi.fn<(dependencies: object, ...rest: unknown[]) => void>(),
  revisions: [] as unknown[],
}));

vi.mock("@/backend/service/agents/AgentPlanControlService", () => ({
  AgentPlanControlService: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanStartActions", () => ({
  AgentPlanStartActions: vi.fn(function (dependencies: unknown) {
    boundary.revisions.push(dependencies);
    return {};
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanReferences", () => ({
  validatePlanReferences: boundary.references,
}));

const START = { id: "start", x: 0, y: 0, type: "start" };
const END = { id: "end", x: 0, y: 0, type: "end" };
const CLOSEOUT = {
  id: "close",
  x: 0,
  y: 0,
  type: "git_closeout",
  name: "Closeout",
  checkCommand: "git status",
  timeoutSeconds: 60,
  bindings: {},
};

function input(changes: Readonly<Record<string, unknown>> = {}): object {
  return planInput({ workspaceId: WORKSPACE_ID, revision: 1, ...changes });
}

/** The stored plan of the input, with the configuration its agent node pinned earlier. */
function storedPlan(
  changes: Partial<AgentPlanView> = {},
  graph: object = input(),
): AgentPlanView {
  const pinned = copyPlanConfiguration(
    catalogAgent(AGENT_ID, { model: "saved" }),
  );
  const parsed = readPlanInput(graph);
  return planView({
    ...parsed,
    nodes: parsed.nodes.map((node) =>
      node.type === "agent" ? { ...node, configuration: pinned } : node,
    ),
    ...changes,
  });
}

function savedPlan({ mocks }: PlanContext): AgentPlan {
  const plan = mocks.plans.save.mock.calls[0]?.[0];
  if (!plan) throw new Error("No plan was saved.");
  return plan;
}

function agentOf(plan: AgentPlan): AgentPlan["nodes"][number] | undefined {
  return plan.nodes.find((node) => node.type === "agent");
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.revisions.length = 0;
});

describe("AgentPlanService.save of a new plan", () => {
  it("stores the plan for its creator in the project of the workspace", async () => {
    const context = createPlanContext();
    const { service, mocks } = context;
    mocks.access.team.mockResolvedValue({
      projectId: null,
      departmentIds: ["dept-1"],
      departmentId: "dept-1",
    });

    const id = await service.save("creator", null, input());

    const plan = savedPlan(context);
    expect(plan).toMatchObject({
      id,
      ownerId: "creator",
      departmentId: "dept-1",
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
    });
    expect(mocks.plans.save.mock.calls[0]?.[1]).toBe(true);
    expect(mocks.plans.save.mock.calls[0]?.[3]).toBe("creator");
    expect(mocks.access.team).toHaveBeenCalledWith("creator", null);
    expect(mocks.access.validateSharing).toHaveBeenCalledWith(plan);
    expect(boundary.references.mock.calls[0]?.slice(1)).toEqual([
      "creator",
      expect.objectContaining({ projectId: PROJECT_ID }),
      PROJECT_ID,
    ]);
  });

  it("pins each agent node to the configuration the catalog offers now", async () => {
    const context = createPlanContext();

    await context.service.save("creator", null, input());

    expect(agentOf(savedPlan(context))).toMatchObject({
      configuration: copyPlanConfiguration(catalogAgent()),
    });
    expect(context.mocks.profiles.resolveDefinition).toHaveBeenCalledWith(
      "creator",
      expect.objectContaining({ agentId: AGENT_ID, projectId: PROJECT_ID }),
    );
  });

  it("runs the journal inside the write with the identifier of the new plan", async () => {
    const context = createPlanContext();
    const journal = vi.fn(async () => undefined);

    const id = await context.service.save("creator", null, input(), journal);

    const bound = context.mocks.plans.save.mock.calls[0]?.[2];
    const transaction = stub<Parameters<NonNullable<typeof bound>>[0]>({});
    await bound?.(transaction);
    expect(journal).toHaveBeenCalledExactlyOnceWith(transaction, id);
  });

  it("stores without a journal binding when none is given", async () => {
    const { service, mocks } = createPlanContext();

    await service.save("creator", null, input());

    expect(mocks.plans.save.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("starts at revision one when the input names none", async () => {
    const context = createPlanContext();

    await context.service.save(
      "creator",
      null,
      planInput({ workspaceId: WORKSPACE_ID }),
    );

    expect(savedPlan(context).revision).toBe(1);
  });

  it("adopts the execution target the workspace resolves", async () => {
    const executionTarget = {
      kind: "remote" as const,
      workspaceId: WORKSPACE_ID,
    };
    const validate = vi.fn(async () => undefined);
    const context = createPlanContext({
      remoteTargets: stub<PlanDependencies["remoteTargets"] & object>({
        validate,
      }),
    });
    context.mocks.workspaces.resolve.mockResolvedValue({
      projectId: PROJECT_ID,
      executionTarget,
    });

    await context.service.save("creator", null, input());

    expect(savedPlan(context)).toMatchObject({ executionTarget });
    expect(validate).toHaveBeenCalledWith(
      "creator",
      expect.objectContaining({ executionTarget }),
    );
  });
});

describe("AgentPlanService.save refusals of a new plan", () => {
  it("refuses a plan that names credentials and stores nothing", async () => {
    const { service, mocks } = createPlanContext();
    const nodes = [
      START,
      agentNode({ instruction: "password=hunter2hunter2hunter2" }),
      END,
    ];

    await expect(
      service.save("creator", null, input({ nodes })),
    ).rejects.toMatchObject({ code: "credentialsInText" });
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("refuses a plan whose declared project differs from its workspace's project", async () => {
    const { service, mocks } = createPlanContext();

    await expect(
      service.save("creator", null, input({ projectId: "project-other" })),
    ).rejects.toThrow(new AgentError("plan_context_changed"));
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("refuses a new Git closeout node and names it", async () => {
    const { service, mocks } = createPlanContext();

    await expect(
      service.save(
        "creator",
        null,
        input({ nodes: [START, CLOSEOUT, END], edges: [] }),
      ),
    ).rejects.toMatchObject({
      constructor: AgentPlanValidationError,
      issues: [
        { nodeId: "close", port: null, reason: "gitCloseoutUnsupported" },
      ],
    });
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("keeps a closeout node the stored plan already contains", async () => {
    const graph = input({ nodes: [START, CLOSEOUT, END], edges: [] });
    const context = createPlanContext();
    context.mocks.access.require.mockResolvedValue(storedPlan({}, graph));

    await context.service.save("owner", "plan-1", graph);

    expect(context.mocks.plans.save).toHaveBeenCalledOnce();
  });
});

describe("AgentPlanService.save of a stored plan", () => {
  it("keeps owner, department and the configuration of an unchanged agent whoever saves", async () => {
    const context = createPlanContext();
    context.mocks.access.require.mockResolvedValue(
      storedPlan({ ownerId: "owner", departmentId: "dept-9" }),
    );

    await context.service.save("member", "plan-1", input());

    const plan = savedPlan(context);
    expect(plan).toMatchObject({
      id: "plan-1",
      ownerId: "owner",
      departmentId: "dept-9",
    });
    expect(context.mocks.plans.save.mock.calls[0]?.[1]).toBe(false);
    expect(context.mocks.access.team).not.toHaveBeenCalled();
    expect(agentOf(plan)).toHaveProperty("configuration.model", "saved");
  });

  it("pins the configuration of the catalog when the node names another agent now", async () => {
    const context = createPlanContext();
    context.mocks.access.require.mockResolvedValue(storedPlan());
    context.mocks.profiles.catalog.mockResolvedValue([
      catalogAgent("agent-2", { model: "fresh" }),
    ]);

    await context.service.save(
      "owner",
      "plan-1",
      input({ nodes: [START, agentNode({ agentId: "agent-2" }), END] }),
    );

    expect(agentOf(savedPlan(context))).toHaveProperty(
      "configuration.model",
      "fresh",
    );
  });

  it("leaves a node unpinned when its agent is not in the catalog", async () => {
    const context = createPlanContext();
    context.mocks.profiles.catalog.mockResolvedValue([]);

    await context.service.save("owner", null, input());

    expect(agentOf(savedPlan(context))).not.toHaveProperty("configuration");
    expect(context.mocks.profiles.resolveDefinition).not.toHaveBeenCalled();
  });

  it("refuses a person who cannot edit the plan", async () => {
    const { service, mocks } = createPlanContext();
    mocks.access.require.mockResolvedValue(storedPlan({ canEdit: false }));

    await expect(service.save("reader", "plan-1", input())).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("reports a conflict when the plan changed since the revision of the input", async () => {
    const { service, mocks } = createPlanContext();
    mocks.access.require.mockResolvedValue(storedPlan({ revision: 4 }));

    await expect(service.save("owner", "plan-1", input())).rejects.toThrow(
      new AgentError("plan_conflict"),
    );
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("lets only the owner move the plan to another project", async () => {
    const context = createPlanContext();
    context.mocks.access.require.mockResolvedValue(
      storedPlan({ projectId: "project-old" }),
    );

    await expect(
      context.service.save("member", "plan-1", input()),
    ).rejects.toThrow(new AgentError("plan_project_owner_only"));
    await context.service.save("owner", "plan-1", input());
    expect(savedPlan(context).projectId).toBe(PROJECT_ID);
  });

  it("hands the same validation to the start actions without storing", async () => {
    const { mocks } = createPlanContext();
    mocks.access.require.mockResolvedValue(storedPlan());
    const [start] = boundary.revisions;
    const revise = stub<{
      revise: (userId: string, id: string, plan: object) => Promise<AgentPlan>;
    }>(start as object).revise;

    const plan = await revise("owner", "plan-1", input());

    expect(plan).toMatchObject({ id: "plan-1", revision: 1 });
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });
});

it("saves a repaired empty selection while still authorizing an empty model that names a connection", async () => {
  const configuration = {
    name: "Choose",
    revision: 1,
    modelProfileId: "",
    model: "",
    provider: null,
    reasoningEffort: null,
    template: { markdown: "", parameters: [], directoryParameter: null },
  };
  const context = createPlanContext();
  await context.service.save(
    "owner",
    null,
    input({ nodes: [START, agentNode({ agentId: "", configuration }), END] }),
  );
  expect(context.mocks.profiles.resolveDefinition).not.toHaveBeenCalled();
  const denied = createPlanContext();
  denied.mocks.profiles.resolveDefinition.mockRejectedValueOnce(
    new AgentError("plan_model_unavailable"),
  );
  await expect(
    denied.service.save(
      "owner",
      null,
      input({
        nodes: [
          START,
          agentNode({
            agentId: "",
            configuration: { ...configuration, connectionId: "hidden" },
          }),
          END,
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "plan_model_unavailable" });
  expect(denied.mocks.profiles.resolveDefinition).toHaveBeenCalled();
  expect(denied.mocks.plans.save).not.toHaveBeenCalled();
});

it.each(["missing", "inactive"])(
  "saves a pinned draft with a %s profile without resolving it",
  async (problem) => {
    const context = createPlanContext();
    const profile = catalogAgent();
    context.mocks.profiles.catalog.mockResolvedValue(
      problem === "missing"
        ? []
        : [
            {
              ...profile,
              availability: {
                isUsable: false,
                reason: "agent_inactive",
                personalChoices: [],
              },
            },
          ],
    );
    const configuration = copyPlanConfiguration(profile);
    await context.service.save(
      "owner",
      null,
      input({ nodes: [START, agentNode({ configuration }), END] }),
    );
    expect(context.mocks.plans.save).toHaveBeenCalledOnce();
    expect(agentOf(savedPlan(context))).toHaveProperty(
      "configuration",
      configuration,
    );
    expect(context.mocks.profiles.resolveDefinition).not.toHaveBeenCalled();
  },
);
