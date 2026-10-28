import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanCard } from "@/app/components/agents/plans/plan-node-card/plan-card";

import {
  agentStep,
  flowContext,
  graphActions,
  i18n,
  renderInFlow,
} from "../plan-flow-fixture";

import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { AgentPlanNode } from "@/definition/AgentPlan";

const TICKET: AgentPlanNode = {
  id: "ticket",
  type: "task",
  x: 0,
  y: 0,
  taskId: "1",
};

function renderCard(
  card: Omit<React.ComponentProps<typeof PlanCard>, "children" | "label">,
  context: Partial<PlanFlowContextValue> = {},
): PlanFlowContextValue {
  const value = flowContext(context);
  renderInFlow(
    <PlanCard {...card} label="Card">
      <p>Body</p>
    </PlanCard>,
    value,
  );
  return value;
}

function article(): HTMLElement {
  return screen.getByRole("article", { name: "Card" });
}

it("selects the node from its title and saves an agent as a template from the menu", async () => {
  const context = renderCard({
    node: agentStep("agent"),
    title: "Reviewer",
    subtitle: "Agent",
  });
  expect(article().textContent).toContain("Agent");
  expect(article().textContent).toContain("Body");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.selectNode", { name: "Card" }),
    }),
  );
  expect(context.graph.select).toHaveBeenCalledWith("agent");
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Card" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.templates.saveAction"),
    }),
  );
  expect(context.requestTemplate).toHaveBeenCalledWith("agent");
});

it("removes the node from its menu and offers no template for a ticket", async () => {
  const context = renderCard({ node: TICKET, title: "Tickets", size: "large" });
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Card" }),
    }),
    { key: "Enter" },
  );
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
  fireEvent.click(
    within(menu).getByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(context.graph.remove).toHaveBeenCalledWith("ticket");
});

it("marks a selected node with an issue and takes the colors of a shown run", () => {
  renderCard(
    {
      node: agentStep("agent"),
      title: "Reviewer",
      runClass: "run-colors",
      status: <span>Running</span>,
    },
    {
      graph: graphActions({
        selectedId: "agent",
        issues: [{ nodeId: "agent", port: null, reason: "port" }],
      }),
    },
  );
  expect(article().className).toContain("run-colors");
  expect(article().className).toContain("ring-2");
  expect(article().className).toContain("border-destructive");
  expect(article().textContent).toContain("Running");
});

it("opens the node dialog from its edit button and keeps the edit button while the menu is locked", () => {
  const onEdit = vi.fn();
  renderCard(
    { node: agentStep("agent"), title: "Reviewer", onEdit },
    { canEdit: false },
  );
  expect(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Card" }),
    }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Card" }),
    }),
  );
  expect(onEdit).toHaveBeenCalledOnce();
});
