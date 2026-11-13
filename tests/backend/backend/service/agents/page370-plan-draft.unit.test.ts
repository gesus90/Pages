import { expect, it } from "vitest";

import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { agentNode, planInput } from "../../agents/agent-plan-input-fixture";
import {
  WORKSPACE_ID,
  catalogAgent,
  createPlanContext,
} from "./agent-plan-service-harness";

it.each([
  { agentId: "prepare_e2e", hasConfiguration: false },
  { agentId: "prepare_e2e", hasConfiguration: true },
  { agentId: "", hasConfiguration: false },
])(
  "saves a missing profile as a draft through reference validation: %j",
  async ({ agentId, hasConfiguration }) => {
    const { service, mocks } = createPlanContext();
    mocks.profiles.catalog.mockResolvedValue([]);
    const configuration = copyPlanConfiguration(catalogAgent());
    const proposed = planInput({
      workspaceId: WORKSPACE_ID,
      nodes: [
        { id: "start", type: "start", x: 0, y: 0 },
        agentNode({
          agentId,
          ...(hasConfiguration ? { configuration } : {}),
        }),
        { id: "end", type: "end", x: 640, y: 0 },
      ],
      edges: [
        { from: "start", to: "a1", fromPort: "flow-out", toPort: "flow-in" },
        { from: "a1", to: "end", fromPort: "flow-out", toPort: "flow-in" },
      ],
    });

    await service.save("owner", null, proposed);

    expect(mocks.plans.save).toHaveBeenCalledOnce();
    const saved = mocks.plans.save.mock.calls[0]?.[0];
    if (!saved) throw new Error("Missing saved draft");
    expect(saved.nodes.find((node) => node.id === "a1")).toMatchObject({
      agentId,
      ...(hasConfiguration ? { configuration } : {}),
    });
    expect(planExecutionIssues(saved, [])).toContainEqual({
      nodeId: "a1",
      port: null,
      reason: "profileMissing",
    });
    expect(mocks.profiles.resolveDefinition).not.toHaveBeenCalled();
    expect(mocks.preparation.prepare).not.toHaveBeenCalled();
  },
);

it("still rejects invalid bindings of a node with a known template", async () => {
  const { service, mocks } = createPlanContext();
  const proposed = planInput({
    workspaceId: WORKSPACE_ID,
    nodes: [
      agentNode({
        configuration: copyPlanConfiguration(catalogAgent()),
        bindings: { unknown: { kind: "literal", value: null } },
      }),
    ],
    edges: [],
  });

  await expect(service.save("owner", null, proposed)).rejects.toMatchObject({
    code: "plan_invalid",
    issues: [{ nodeId: "a1", port: "unknown", reason: "port" }],
  });
  expect(mocks.plans.save).not.toHaveBeenCalled();
});

it.each([false, true])(
  "saves an inactive profile through reference validation with configuration=%s",
  async (hasConfiguration) => {
    const { service, mocks } = createPlanContext();
    const profile = catalogAgent();
    const inactive = {
      ...profile,
      availability: {
        isUsable: false,
        reason: "agent_inactive" as const,
        personalChoices: [],
      },
    };
    mocks.profiles.catalog.mockResolvedValue([inactive]);
    const proposed = planInput({
      workspaceId: WORKSPACE_ID,
      nodes: [
        agentNode({
          agentId: inactive.id,
          ...(hasConfiguration
            ? { configuration: copyPlanConfiguration(profile) }
            : {}),
        }),
      ],
      edges: [],
    });

    await service.save("owner", null, proposed);

    expect(mocks.plans.save).toHaveBeenCalledOnce();
    const saved = mocks.plans.save.mock.calls[0]?.[0];
    if (!saved) throw new Error("Missing saved draft");
    expect(planExecutionIssues(saved, [inactive])).toContainEqual({
      nodeId: "a1",
      port: null,
      reason: "profileInactive",
    });
    expect(mocks.profiles.resolveDefinition).not.toHaveBeenCalled();
  },
);
