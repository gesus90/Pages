import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  collectToasts,
  i18n,
  planServer,
  pressSave,
  renderPlanPage,
} from "./page61-plan-fixture";

const pointerCapture = HTMLElement.prototype.setPointerCapture;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.setPointerCapture = pointerCapture;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

function grid(): HTMLElement {
  return screen.getByRole("region", { name: i18n.t("plans.canvas") });
}

function links(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".react-flow__edge")].map(
    (edge) => edge.getAttribute("data-id") ?? "",
  );
}

async function ready(container: HTMLElement): Promise<void> {
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  // React Flow draws the edges once its nodes are measured.
  await waitFor(() => expect(links(container)).not.toHaveLength(0));
}

function node(name: string): HTMLElement {
  return within(grid()).getByRole("article", { name });
}

it("selects one connection on the grid and disconnects it while both nodes stay", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const [ticketLink] = screen.getAllByRole("button", {
    name: /SYN-1: Open work → Reviewer · ticket/,
    pressed: false,
  });
  if (!ticketLink) throw new Error("Missing ticket connection");
  fireEvent.click(ticketLink);
  const name = "SYN-1: Open work → Reviewer · ticket";
  // A selected connection offers to be disconnected at both of its ends.
  expect(
    await within(grid()).findByRole("button", {
      name: i18n.t("plans.removeLinkAtTarget", { name }),
    }),
  ).toBeDefined();
  fireEvent.click(
    await within(grid()).findByRole("button", {
      name: i18n.t("plans.removeLinkAtSource", { name }),
    }),
  );
  await waitFor(() =>
    expect(links(container)).toEqual([
      "flow:start:first",
      "flow:first:second",
      "flow:second:end",
      "data:second:notes",
    ]),
  );
  expect(node("SYN-1: Open work")).toBeDefined();
  expect(node("Reviewer")).toBeDefined();
});

it("disconnects a selected flow edge with the Delete key", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const edge = container.querySelector(
    '.react-flow__edge[data-id="flow:first:second"]',
  );
  if (!edge) throw new Error("Missing flow edge");
  fireEvent.click(edge);
  fireEvent.keyDown(grid(), { key: "Delete" });
  expect(links(container)).not.toContain("flow:first:second");
  expect(node("Reviewer")).toBeDefined();
  expect(node("Writer")).toBeDefined();
});

it("deletes a node with every connection it had and keeps the rest of the graph", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  fireEvent.keyDown(
    within(node("Writer")).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Writer" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.delete"),
    }),
  );
  expect(within(grid()).queryByRole("article", { name: "Writer" })).toBeNull();
  await waitFor(() =>
    expect(links(container)).toEqual(["flow:start:first", "data:first:ticket"]),
  );
  for (const name of ["Start", "Reviewer", "Ende", "SYN-1: Open work", "spare"])
    expect(node(name)).toBeDefined();
});

it("saves the removal so that the reopened plan still lacks the node and its connections", async () => {
  const server = planServer();
  const toasts = collectToasts();
  const first = renderPlanPage(server);
  await ready(first.container);
  fireEvent.keyDown(
    within(node("Writer")).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Writer" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.delete"),
    }),
  );
  pressSave();
  await waitFor(() => expect(server.saved).toHaveLength(1));
  await waitFor(() => expect(toasts).toEqual([i18n.t("plans.saved")]));
  first.unmount();
  const reopened = renderPlanPage(server);
  await ready(reopened.container);
  expect(within(grid()).queryByRole("article", { name: "Writer" })).toBeNull();
  expect(links(reopened.container)).toEqual([
    "flow:start:first",
    "data:first:ticket",
  ]);
  expect(server.plan?.nodes.map((entry) => entry.id)).toEqual([
    "start",
    "first",
    "end",
    "ticket",
    "spare",
  ]);
});

it("offers a ticket node one ticket OUT, no flow port, and binds it to the ticket parameter", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const ticket = node("SYN-1: Open work");
  expect(
    within(ticket).queryByRole("button", { name: "Ablauf IN" }),
  ).toBeNull();
  expect(
    within(ticket).queryByRole("button", { name: "Ablauf OUT" }),
  ).toBeNull();
  // The plan is executable as it is: no node or port carries an issue.
  expect(grid().querySelectorAll(".border-destructive")).toHaveLength(0);
  fireEvent.click(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.disconnect", { name: "ticket" }),
    }),
  );
  await waitFor(() =>
    expect(links(container)).not.toContain("data:first:ticket"),
  );
  const outputs = within(ticket).getAllByRole("button", {
    name: i18n.t("plans.ticketOut"),
  });
  expect(outputs).toHaveLength(1);
  fireEvent.click(outputs[0] ?? ticket);
  fireEvent.click(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.bindPort", { parameter: "ticket", name: "Reviewer" }),
    }),
  );
  await waitFor(() => expect(links(container)).toContain("data:first:ticket"));
  expect(ticket.className).not.toContain("border-destructive");
});

it("lays the graph over the whole work area beside the navigation with the floating node palette", async () => {
  renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  const canvas = screen.getByRole("region", { name: i18n.t("plans.canvas") });
  const area = canvas.parentElement;
  expect(area?.className).toContain("fixed inset-x-0 top-19 bottom-0");
  expect(area?.className).toContain("md:left-(--app-sidebar-width)");
  expect(canvas.className).toContain("absolute inset-0");
  expect(
    screen
      .getAllByRole("complementary")
      .map((panel) => panel.getAttribute("aria-label")),
  ).toEqual([i18n.t("plans.palette.label")]);
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.collapsePanel") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.expandPanel") }),
  ).toBeNull();
});
