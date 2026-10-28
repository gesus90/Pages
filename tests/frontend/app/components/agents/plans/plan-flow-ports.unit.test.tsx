import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanFlowPorts,
  planInTargetClass,
} from "@/app/components/agents/plans/plan-flow-ports";
import styles from "@/app/components/agents/plans/plan-canvas.module.css";

import {
  agentStep,
  flowContext,
  graphActions,
  i18n,
  renderInFlow,
} from "./plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanNode } from "@/definition/AgentPlan";

const START: AgentPlanNode = { id: "start", type: "start", x: 0, y: 0 };
const END: AgentPlanNode = { id: "end", type: "end", x: 0, y: 0 };
const TICKET: AgentPlanNode = {
  id: "ticket",
  type: "task",
  x: 0,
  y: 0,
  taskId: "1",
};

function renderPorts(
  node: AgentPlanNode,
  options: {
    readonly graph?: PlanGraphActions;
    readonly canEdit?: boolean;
    readonly isCompact?: boolean;
  } = {},
): { readonly graph: PlanGraphActions; readonly container: HTMLElement } {
  const graph = options.graph ?? graphActions();
  const canEdit = options.canEdit ?? true;
  const { container } = renderInFlow(
    <PlanFlowPorts
      node={node}
      graph={graph}
      canEdit={canEdit}
      isCompact={options.isCompact}
    />,
    flowContext({ graph, canEdit }),
  );
  return { graph, container };
}

function inPort(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("plans.flowIn") });
}

function outPort(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("plans.flowOut") });
}

function handleIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-handleid]")].map((handle) =>
    handle.getAttribute("data-handleid"),
  );
}

it("leaves a pure value source without flow ports", () => {
  const { container } = renderPorts(TICKET);

  expect(container.childElementCount).toBe(0);
});

it("gives start only an OUT that opens a flow connection", () => {
  const { graph, container } = renderPorts(START);

  expect(
    screen.queryByRole("button", { name: i18n.t("plans.flowIn") }),
  ).toBeNull();
  fireEvent.click(outPort());

  expect(graph.begin).toHaveBeenCalledWith({ kind: "flow", nodeId: "start" });
  expect(handleIds(container)).toEqual(["flow-out"]);
  expect(outPort().textContent).toBe(i18n.t("plans.flowOut"));
});

it("gives end only an IN that completes the open connection", () => {
  const { graph, container } = renderPorts(END);

  expect(
    screen.queryByRole("button", { name: i18n.t("plans.flowOut") }),
  ).toBeNull();
  fireEvent.click(inPort());

  expect(graph.connect).toHaveBeenCalledWith("end");
  expect(handleIds(container)).toEqual(["flow-in"]);
});

it("labels the ports of a card shortly and keeps their full names", () => {
  renderPorts(agentStep("writer"), { isCompact: true });

  expect(inPort().textContent).toBe(i18n.t("plans.flowInShort"));
  expect(outPort().textContent).toBe(i18n.t("plans.flowOutShort"));
  expect(inPort().getAttribute("data-plan-in")).toBe("writer");
  expect(outPort().getAttribute("data-plan-out")).toBe("writer");
});

it("marks the ports a finding names", () => {
  const graph = graphActions({
    issues: [
      { nodeId: "writer", port: "flow-in", reason: "flowIn" },
      { nodeId: "writer", port: "flow-out", reason: "flowOut" },
      { nodeId: "other", port: "flow-in", reason: "flowIn" },
    ],
  });
  const { container } = renderPorts(agentStep("writer"), { graph });

  expect(inPort().classList).toContain("text-destructive");
  expect(outPort().classList).toContain("text-destructive");
  expect(container.querySelectorAll(`.${styles.invalidHandle}`)).toHaveLength(
    2,
  );
});

it("marks the OUT of the open flow connection and a refused IN", () => {
  const graph = graphActions({
    connection: { kind: "flow", nodeId: "writer" },
    canConnect: vi.fn(() => false),
  });
  const { container } = renderPorts(agentStep("writer"), { graph });

  expect(inPort().classList).toContain("cursor-not-allowed");
  expect(outPort().classList).toContain("border-primary");
  expect(container.querySelectorAll(`.${styles.invalidHandle}`)).toHaveLength(
    0,
  );
});

it("does not mark the OUT for a value connection of the same node", () => {
  renderPorts(agentStep("writer"), {
    graph: graphActions({ connection: { kind: "result", nodeId: "writer" } }),
  });

  expect(outPort().classList).not.toContain("border-primary");
  expect(inPort().classList).toContain("border-success");
});

it("locks both ports on a read-only canvas", () => {
  renderPorts(agentStep("writer"), { canEdit: false });

  expect(inPort().hasAttribute("disabled")).toBe(true);
  expect(outPort().hasAttribute("disabled")).toBe(true);
});

it("marks an IN only while a connection is open, by whether it may end there", () => {
  const closed = graphActions();
  const refusing = graphActions({
    connection: { kind: "source", nodeId: "ticket" },
    canConnect: vi.fn(() => false),
  });
  const accepting = graphActions({
    connection: { kind: "source", nodeId: "ticket" },
  });

  expect(planInTargetClass(closed, "writer")).toBe(false);
  expect(planInTargetClass(refusing, "writer", "notes")).toBe(
    "cursor-not-allowed border-dashed opacity-50",
  );
  expect(refusing.canConnect).toHaveBeenCalledWith("writer", "notes");
  expect(planInTargetClass(accepting, "writer")).toBe(
    "border-success bg-success-subtle text-success",
  );
});
