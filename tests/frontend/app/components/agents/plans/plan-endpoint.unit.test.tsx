import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanEndpoint } from "@/app/components/agents/plans/plan-endpoint";

import { runStep } from "../page72-run-fixture";
import {
  flowContext,
  graphActions,
  i18n,
  renderInFlow,
} from "./plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

const START: AgentPlanNode = { id: "start", type: "start", x: 0, y: 0 };
const END: AgentPlanNode = { id: "end", type: "end", x: 900, y: 0 };
const START_LABEL = i18n.t("plans.nodeType.start");
const END_LABEL = i18n.t("plans.nodeType.end");

function renderEndpoint(
  node: AgentPlanNode,
  options: {
    readonly graph?: PlanGraphActions;
    readonly canEdit?: boolean;
    readonly hasRun?: boolean;
    readonly result?: AgentPlanStepResult;
  } = {},
): { readonly graph: PlanGraphActions; readonly container: HTMLElement } {
  const graph = options.graph ?? graphActions();
  const canEdit = options.canEdit ?? true;
  const { container } = renderInFlow(
    <PlanEndpoint
      node={node}
      graph={graph}
      canEdit={canEdit}
      hasRun={options.hasRun ?? false}
      result={options.result}
    />,
    flowContext({ graph, canEdit }),
  );
  return { graph, container };
}

function card(label: string): HTMLElement {
  return screen.getByRole("article", { name: label });
}

function selectButton(label: string): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.selectNode", { name: label }),
  });
}

function handleIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-handleid]")].map((handle) =>
    handle.getAttribute("data-handleid"),
  );
}

it("selects start by its name and opens a flow connection from its only OUT", () => {
  const { graph, container } = renderEndpoint(START);

  expect(selectButton(START_LABEL).getAttribute("title")).toBe(START_LABEL);
  expect(selectButton(START_LABEL).classList).toContain("cursor-grab");
  expect(selectButton(START_LABEL).getAttribute("data-plan-handle")).toBe(
    "start",
  );
  fireEvent.click(selectButton(START_LABEL));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.flowOut") }),
  );

  expect(graph.select).toHaveBeenCalledWith("start");
  expect(graph.begin).toHaveBeenCalledWith({ kind: "flow", nodeId: "start" });
  expect(handleIds(container)).toEqual(["flow-out"]);
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.flowIn") }),
  ).toBeNull();
});

it("ends the open connection at the only IN of end and marks whether it may", () => {
  const graph = graphActions({
    connection: { kind: "flow", nodeId: "start" },
    canConnect: vi.fn(() => false),
  });
  const { container } = renderEndpoint(END, { graph });
  const port = screen.getByRole("button", { name: i18n.t("plans.flowIn") });

  expect(port.classList).toContain("cursor-not-allowed");
  fireEvent.click(port);

  expect(graph.connect).toHaveBeenCalledWith("end");
  expect(handleIds(container)).toEqual(["flow-in"]);
});

it("removes an endpoint from its menu", async () => {
  const { graph } = renderEndpoint(END);

  fireEvent.keyDown(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: END_LABEL }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: i18n.t("plans.delete") }),
  );

  expect(graph.remove).toHaveBeenCalledWith("end");
});

it("marks the selected endpoint and one with a finding", () => {
  renderEndpoint(START, {
    graph: graphActions({
      selectedId: "start",
      issues: [{ nodeId: "start", port: "flow-out", reason: "start" }],
    }),
  });

  expect(card(START_LABEL).classList).toContain("ring-2");
  expect(card(START_LABEL).classList).toContain("border-destructive");
});

it("leaves an unselected endpoint without findings unmarked", () => {
  renderEndpoint(START, {
    graph: graphActions({
      selectedId: "end",
      issues: [{ nodeId: "end", port: "flow-in", reason: "end" }],
    }),
  });

  expect(card(START_LABEL).classList).not.toContain("ring-2");
  expect(card(START_LABEL).classList).not.toContain("border-destructive");
});

it("shows the run status of an endpoint in its badge and title", () => {
  renderEndpoint(END, {
    hasRun: true,
    result: runStep("end", { status: "succeeded" }),
  });
  const status = i18n.t("plans.status.succeeded");

  expect(selectButton(END_LABEL).getAttribute("title")).toBe(status);
  // The name button and the compact badge both carry the status.
  expect(within(card(END_LABEL)).getAllByTitle(status)).toHaveLength(2);
  expect(within(card(END_LABEL)).getByText(status).classList).toContain(
    "sr-only",
  );
});

it("reports a blocked or not yet reached endpoint of a run", () => {
  renderEndpoint(END, {
    hasRun: true,
    result: runStep("end", { isBlocked: true }),
  });
  renderEndpoint(START, { hasRun: true });

  expect(selectButton(END_LABEL).getAttribute("title")).toBe(
    i18n.t("plans.blocked"),
  );
  expect(selectButton(START_LABEL).getAttribute("title")).toBe(
    i18n.t("plans.status.waiting"),
  );
});

it("locks the port and the menu of a read-only endpoint", () => {
  renderEndpoint(START, { canEdit: false });

  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.flowOut") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", {
        name: i18n.t("settings.agents.actionsFor", { name: START_LABEL }),
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(selectButton(START_LABEL).classList).not.toContain("cursor-grab");
});
