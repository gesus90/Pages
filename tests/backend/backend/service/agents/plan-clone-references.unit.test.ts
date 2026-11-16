import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCloneReferences } from "@/backend/service/agents/AgentPlanCloneReferences";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { agent, script } from "../../../definition/plan-fixtures";

import type { CloneReferenceDependencies } from "@/backend/service/agents/AgentPlanCloneReferences";
import type { AgentPlanCloneAdjustment } from "@/definition/AgentPlanClone";

function fixture(): {
  dependencies: CloneReferenceDependencies;
  adjustments: AgentPlanCloneAdjustment[];
} {
  return {
    dependencies: {
      profiles: partial({
        catalog: async () => [],
        planModels: async () => [],
      }),
      parameters: partial({
        requireTicket: async () => {
          throw new AgentError("parameter_reference_unavailable");
        },
        requireWiki: async () => undefined,
      }),
      tasks: partial({
        snapshot: async () => {
          throw new AgentError("parameter_reference_unavailable");
        },
      }),
      workspaces: partial({ choices: async () => [] }),
    },
    adjustments: [],
  };
}

it("clears unavailable resources while keeping unrelated graph and literal values", async () => {
  const { dependencies, adjustments } = fixture();
  const plan = {
    ...emptyAgentPlan(),
    projectId: "project",
    nodes: [
      { id: "ticket", type: "task" as const, taskId: "hidden", x: 0, y: 0 },
      {
        id: "value",
        type: "parameter" as const,
        name: "Value",
        format: "string" as const,
        value: { type: "ticket" as const, ticketId: "hidden" },
        x: 0,
        y: 0,
      },
      script("script", {
        wiki: { kind: "literal", value: { type: "wiki", pageId: "visible" } },
      }),
    ],
  };
  const result = await new AgentPlanCloneReferences(
    dependencies,
    "user",
    adjustments,
  ).prepare(plan);
  expect(result.nodes[0]).toMatchObject({ id: "ticket", taskId: "" });
  expect(result.nodes[1]).toMatchObject({
    id: "value",
    value: { type: "text", text: "" },
  });
  expect(result.nodes[2]).toMatchObject({
    bindings: { wiki: { value: { type: "wiki", pageId: "visible" } } },
  });
  expect(adjustments).toEqual([
    { code: "reference_cleared", nodeId: "ticket" },
    { code: "reference_cleared", nodeId: "value" },
  ]);
});

it("marks an unavailable agent once and propagates unexpected boundary failures", async () => {
  const { dependencies, adjustments } = fixture();
  const plan = { ...emptyAgentPlan(), nodes: [agent("agent")] };
  const result = await new AgentPlanCloneReferences(
    dependencies,
    "user",
    adjustments,
  ).prepare(plan);
  expect(result.nodes[0]).toMatchObject({
    agentId: "",
    personalAgentId: null,
    selectionRequired: "agent",
  });
  expect(adjustments).toEqual([{ code: "reference_cleared", nodeId: "agent" }]);
  const failing = {
    ...dependencies,
    profiles: partial<CloneReferenceDependencies["profiles"]>({
      catalog: vi.fn().mockRejectedValue(new Error("offline")),
      planModels: async () => [],
    }),
  };
  await expect(
    new AgentPlanCloneReferences(failing, "user", []).prepare(plan),
  ).rejects.toThrow("offline");
});

it("clears inaccessible workspace and asset literals once per script while retaining allowed references", async () => {
  const { dependencies, adjustments } = fixture();
  const plan = {
    ...emptyAgentPlan(),
    projectId: "project",
    nodes: [
      script("script", {
        missing: {
          kind: "literal",
          value: { type: "workspace", workspaceId: "missing" },
        },
        asset: {
          kind: "literal",
          value: { type: "asset", assetId: "other-project" },
        },
        wiki: { kind: "literal", value: { type: "wiki", pageId: "visible" } },
      }),
    ],
  };
  const result = await new AgentPlanCloneReferences(
    dependencies,
    "user",
    adjustments,
  ).prepare(plan);
  expect(result.nodes[0]).toMatchObject({
    bindings: {
      missing: { kind: "literal", value: null },
      asset: { kind: "literal", value: null },
      wiki: { kind: "literal", value: { type: "wiki", pageId: "visible" } },
    },
  });
  expect(adjustments).toEqual([
    { code: "reference_cleared", nodeId: "script" },
  ]);
});

it("removes an unavailable decision model while preserving the node and its input", async () => {
  const { dependencies, adjustments } = fixture();
  const decision = {
    id: "decision",
    type: "decision" as const,
    x: 0,
    y: 0,
    mode: "model" as const,
    model: {
      connectionId: "hidden",
      provider: "codex_cli" as const,
      model: "model",
      reasoningEffort: null,
    },
    input: { kind: "source" as const, nodeId: "source" },
  };
  const plan = { ...emptyAgentPlan(), nodes: [decision] };
  const result = await new AgentPlanCloneReferences(
    dependencies,
    "user",
    adjustments,
  ).prepare(plan);
  expect(result.nodes[0]).toMatchObject({
    id: "decision",
    model: undefined,
    input: decision.input,
  });
  expect(adjustments).toEqual([
    { code: "reference_cleared", nodeId: "decision" },
  ]);
});
