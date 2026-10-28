import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanSourceCard } from "@/app/components/agents/plans/plan-node-card/plan-source-card";

import { SOURCES } from "../../page61-plan-fixture";
import {
  flowContext,
  graphActions,
  i18n,
  planOf,
  renderInFlow,
} from "../plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanNode } from "@/definition/AgentPlan";

type SourceNode = Extract<
  AgentPlanNode,
  { type: "parameter" | "task" | "variable" }
>;

function renderSource(
  node: SourceNode,
  globals: Readonly<Record<string, string>> = {},
): PlanGraphActions {
  const graph = graphActions();
  renderInFlow(
    <PlanSourceCard node={node} />,
    flowContext({
      graph,
      sources: SOURCES,
      draft: { ...planOf([node]), globals },
    }),
  );
  return graph;
}

it("changes only the ticket node when another ticket is chosen", () => {
  const node: SourceNode = {
    id: "ticket",
    type: "task",
    x: 0,
    y: 0,
    taskId: "1",
  };
  const graph = renderSource(node);
  const card = screen.getByRole("article", { name: "SYN-1: Open work" });
  expect(card.textContent).toContain(i18n.t("plans.ticketsCard"));
  fireEvent.click(
    within(card).getByRole("combobox", { name: i18n.t("plans.ticketChoice") }),
  );
  fireEvent.click(screen.getByRole("option", { name: /SYN-4/u }));
  expect(graph.replaceNode).toHaveBeenCalledWith({ ...node, taskId: "4" });
});

it("names a ticket card whose ticket is gone as unavailable", () => {
  renderSource({ id: "ticket", type: "task", x: 0, y: 0, taskId: "gone" });
  expect(
    screen.getByRole("article", { name: i18n.t("plans.ticketUnavailable") }),
  ).toBeDefined();
});

it("shows a plan variable with its global value, or empty without one", () => {
  const node: SourceNode = {
    id: "variable",
    type: "variable",
    x: 0,
    y: 0,
    name: "region",
  };
  renderSource(node, { region: "Europe" });
  const card = screen.getByRole("article", { name: "region" });
  expect(card.textContent).toContain(i18n.t("plans.nodeType.variable"));
  expect(within(card).getByTitle("Europe").textContent).toBe("Europe");
});

it("shows an empty value for a variable the plan does not define", () => {
  renderSource({
    id: "variable",
    type: "variable",
    x: 0,
    y: 0,
    name: "missing",
  });
  const card = screen.getByRole("article", { name: "missing" });
  expect(within(card).getByTitle("").textContent).toBe("");
});

it("shows a parameter with its fields under the parameter type", () => {
  renderSource({
    id: "value",
    type: "parameter",
    x: 0,
    y: 0,
    name: "notes",
    format: "string",
    value: { type: "text", text: "typed" },
  });
  const card = screen.getByRole("article", { name: "notes" });
  expect(card.textContent).toContain(i18n.t("plans.nodeType.parameter"));
  expect(
    within(card).getByRole("textbox", {
      name: i18n.t("plans.parameterValue", { name: "notes" }),
    }),
  ).toHaveProperty("value", "typed");
});
