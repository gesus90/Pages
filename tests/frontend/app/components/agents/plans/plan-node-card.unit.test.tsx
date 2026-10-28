import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanNodeCard } from "@/app/components/agents/plans/plan-node-card";

import { SOURCES } from "../page61-plan-fixture";
import { runStep, syntheticRun, syntheticSession } from "../page72-run-fixture";
import {
  agentStep,
  flowContext,
  groupNode,
  i18n,
  loopNode,
  planOf,
  renderInFlow,
  scriptStep,
} from "./plan-flow-fixture";
import { loopIteration } from "./plan-loop-fixture";

import type { NodeProps } from "@xyflow/react";
import type { PlanFlowNode } from "@/app/components/agents/plans/plan-flow-model";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { AgentPlanNode } from "@/definition/AgentPlan";

function cardProps(node: AgentPlanNode): NodeProps<PlanFlowNode> {
  return {
    id: node.id,
    type: "plan",
    data: { node },
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

function renderCard(
  node: AgentPlanNode,
  overrides: Partial<PlanFlowContextValue> = {},
): PlanFlowContextValue {
  const context = flowContext({
    draft: planOf([node]),
    sources: SOURCES,
    ...overrides,
  });
  renderInFlow(<PlanNodeCard {...cardProps(node)} />, context);
  return context;
}

it("renders start and end as compact checkpoints with their recorded status", () => {
  renderCard(
    { id: "start", type: "start", x: 0, y: 0 },
    {
      run: {
        ...syntheticRun(),
        steps: [runStep("start", { status: "succeeded" })],
      },
    },
  );
  expect(
    screen.getByRole("article", { name: i18n.t("plans.nodeType.start") }),
  ).toBeDefined();
});

it("renders a group frame whose arrow collapses it through the canvas", () => {
  const group = groupNode("group", []);
  const context = renderCard(group);
  expect(
    screen.getByRole("region", {
      name: i18n.t("plans.groups.frame", { name: "Group group" }),
    }),
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.collapse") }),
  );
  expect(context.toggleGroup).toHaveBeenCalledWith("group");
});

it("renders a collapsed group with its arrow to expand it", () => {
  renderCard(groupNode("group", []), { collapsedGroups: new Set(["group"]) });
  expect(
    screen.getByRole("button", { name: i18n.t("plans.groups.expand") }),
  ).toBeDefined();
});

it("renders a loop frame", () => {
  renderCard(loopNode("loop", []));
  expect(
    screen.getByRole("region", {
      name: i18n.t("plans.loops.frame", { name: "Loop loop" }),
    }),
  ).toBeDefined();
});

it("shows an agent with the status of its newest loop iteration", () => {
  const member = { ...agentStep("member"), agentId: "reviewer" };
  const run = {
    ...syntheticRun(),
    loops: [
      {
        id: "loop",
        name: "Loop",
        status: "running" as const,
        count: null,
        sessionPolicy: "reuse" as const,
        condition: null,
        iterations: [
          {
            ...loopIteration(1, { state: "not_evaluated", reason: "disabled" }),
            nodes: [runStep("member", { status: "failed" })],
          },
        ],
        sessions: [],
        completion: null,
        cleanup: "not_needed" as const,
        startedAt: null,
        endedAt: null,
        error: null,
      },
    ],
  };
  renderCard(member, { run });
  const card = screen.getByRole("article", { name: "Reviewer" });
  expect(card.textContent).toContain(i18n.t("plans.status.failed"));
});

it("shows an open business report on the agent whose execution completed", () => {
  const node = { ...agentStep("reviewer"), agentId: "reviewer" };
  const run = {
    ...syntheticRun(),
    steps: [
      runStep(node.id, { status: "succeeded", session: syntheticSession() }),
    ],
  };
  renderCard(node, { run });
  const card = screen.getByRole("article", { name: "Reviewer" });
  expect(card.className).toContain("text-warning");
  expect(card.textContent).toContain(i18n.t("plans.reportOpen"));
});

it("renders a script card", () => {
  renderCard(scriptStep("script", 1));
  expect(screen.getByRole("article", { name: "Script script" })).toBeDefined();
});

it("renders a parameter as a value source", () => {
  renderCard({
    id: "value",
    type: "parameter",
    x: 0,
    y: 0,
    name: "notes",
    format: "string",
    value: { type: "text", text: "" },
  });
  expect(screen.getByRole("article", { name: "notes" })).toBeDefined();
});
