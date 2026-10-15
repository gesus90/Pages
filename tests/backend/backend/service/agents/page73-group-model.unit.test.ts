import { expect, it } from "vitest";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { validateGroupRuntimes } from "@/backend/service/agents/AgentPlanGroupRuntime";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";

import { groupFixture } from "./page73-group-fixture";

it("resolves inherited Codex defaults before comparing the shared configuration", async () => {
  const { group, snapshot } = await groupFixture();
  const steps = snapshot.steps.map((step, index) =>
    index === 0
      ? { ...step, template: { ...step.template, run: undefined } }
      : step,
  );
  expect(() => validateGroupRuntimes([group], steps)).not.toThrow();
});

it("preserves group membership and failing-agent diagnostics when a run is reloaded", async () => {
  const { base } = await groupFixture();
  const result = {
    id: "child",
    groupId: "group",
    name: "Child",
    status: "failed",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: "plan_acceptance_failed",
  };
  const run = readPlanRun({
    ...base.run,
    steps: [
      result,
      { ...result, id: "group", groupId: undefined, failedStepId: "child" },
    ],
  });
  expect(run.steps[0]?.groupId).toBe("group");
  expect(run.steps[1]?.failedStepId).toBe("child");
});

it("round-trips an ordered group and freezes the same boundary value for both agents", async () => {
  const fixture = await groupFixture();
  expect(readPlanInput(fixture.plan).nodes).toEqual(fixture.plan.nodes);
  expect(planExecutionIssues(fixture.plan, [fixture.source])).toEqual([]);
  expect(fixture.snapshot.steps.map((step) => step.step.id)).toEqual([
    "first",
    "second",
  ]);
  expect(
    fixture.snapshot.steps.map(
      (step) => step.prepared.parameters.values.shared,
    ),
  ).toEqual([
    { type: "text", text: "shared-text" },
    { type: "text", text: "shared-text" },
  ]);
  expect(
    fixture.snapshot.plan.edges.map((edge) => [edge.from, edge.to]),
  ).toEqual([
    ["start", "first"],
    ["second", "end"],
    ["first", "second"],
  ]);
});

it("rejects missing values, wrong types, deleted ports and groups with fewer than two agents", async () => {
  const { plan, group, source } = await groupFixture();
  for (const [changed, reason] of [
    [{ ...group, bindings: {} }, "required"],
    [
      {
        ...group,
        bindings: {
          shared: {
            kind: "literal" as const,
            value: { type: "number" as const, number: 3 },
          },
        },
      },
      "type",
    ],
    [{ ...group, parameters: [] }, "source"],
    [{ ...group, steps: group.steps.slice(0, 1) }, "groupSize"],
  ] as const) {
    const issues = planExecutionIssues(
      {
        ...plan,
        nodes: plan.nodes.map((node) =>
          node.id === group.id ? changed : node,
        ),
      },
      [source],
    );
    expect(issues.some((issue) => issue.reason === reason)).toBe(true);
  }
});

it("compares resolved adapter IDs and every shared runtime field, independently of model names", async () => {
  const { group, snapshot } = await groupFixture();
  const first = snapshot.steps[0];
  const second = snapshot.steps[1];
  if (!first || !second) throw new Error("Missing fixture steps");
  expect(() => validateGroupRuntimes([group], snapshot.steps)).not.toThrow();
  const variants = [
    { ...second, provider: "openrouter" as const, model: "anthropic/claude" },
    { ...second, provider: "claude_code" as const },
    { ...second, connectionId: "another-access" },
    { ...second, model: "another-model" },
    { ...second, reasoningEffort: "high" },
    {
      ...second,
      prepared: {
        ...second.prepared,
        workspace: { ...second.prepared.workspace, path: "/other" },
      },
    },
    {
      ...second,
      template: { ...second.template, run: acpRunOptions("yolo", 0) },
    },
  ];
  for (const variant of variants) {
    try {
      validateGroupRuntimes([group], [first, variant]);
      throw new Error("Expected a configuration refusal");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentPlanValidationError);
      if (!(error instanceof AgentPlanValidationError)) throw error;
      expect(error.issues[0]?.nodeId).toBe("second");
      expect(error.issues[0]?.port).toBeTruthy();
    }
  }
});

it("refuses OpenRouter and direct Claude as distinct technical adapters even with the same model label", async () => {
  const { plan, group, source } = await groupFixture();
  const providers = ["openrouter", "claude_code"] as const;
  const changed = {
    ...group,
    steps: group.steps.map((step, index) => ({
      ...step,
      configuration: step.configuration
        ? {
            ...step.configuration,
            provider: providers[index] ?? "openrouter",
            model: "claude-identical-label",
          }
        : undefined,
    })),
  };
  const issues = planExecutionIssues(
    {
      ...plan,
      nodes: plan.nodes.map((node) => (node.id === group.id ? changed : node)),
    },
    [source],
  );
  expect(issues).toEqual(
    expect.arrayContaining([
      { nodeId: "first", port: "provider/adapter", reason: "groupProvider" },
      { nodeId: "second", port: "provider/adapter", reason: "groupProvider" },
      {
        nodeId: "second",
        port: "provider/adapter",
        reason: "groupConfiguration",
      },
    ]),
  );
});

it.each([
  { name: "connectionId", change: { connectionId: "other-account" } },
  { name: "model", change: { model: "other-model" } },
  { name: "reasoningEffort", change: { reasoningEffort: "high" } },
])(
  "identifies the agent and conflicting $name without exposing configuration values",
  async ({ name, change }) => {
    const { group, snapshot } = await groupFixture();
    const [first, second] = snapshot.steps;
    if (!first || !second) throw new Error("Missing steps");
    try {
      validateGroupRuntimes([group], [first, { ...second, ...change }]);
      throw new Error("Expected refusal");
    } catch (error: unknown) {
      if (!(error instanceof AgentPlanValidationError)) throw error;
      expect(error.issues).toEqual([
        { nodeId: "second", port: name, reason: "groupConfiguration" },
      ]);
      expect(error.message).not.toContain("other-account");
      expect(error.message).not.toContain("other-model");
    }
  },
);
