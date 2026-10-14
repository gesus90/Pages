import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { i18n, planServer, renderPlanPage } from "./page61-plan-fixture";

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
  return screen.getByRole("region", { name: i18n.t("plans.grid") });
}

function links(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-plan-link]")].map(
    (path) => path.getAttribute("data-plan-link") ?? "",
  );
}

function node(name: string): HTMLElement {
  return within(grid()).getByRole("article", { name });
}

function layer(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>("[data-plan-layer]");
  if (!element) throw new Error("Missing plan layer");
  return element;
}

it("selects one connection on the grid and disconnects it while both nodes stay", async () => {
  const { container } = renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  const ticketLink = container.querySelector(
    '[data-plan-link="data:first:ticket"]',
  );
  if (!ticketLink) throw new Error("Missing ticket connection");
  fireEvent.click(ticketLink);
  fireEvent.click(
    within(grid()).getByRole("button", {
      name: i18n.t("plans.removeLink", {
        name: "SYN-1: Open work → Reviewer · ticket",
      }),
    }),
  );
  expect(links(container)).toEqual([
    "flow:start:first",
    "flow:first:second",
    "flow:second:end",
    "data:second:notes",
  ]);
  expect(node("SYN-1: Open work")).toBeDefined();
  expect(node("Reviewer")).toBeDefined();
});

it("disconnects a selected flow edge with the Delete key", async () => {
  const { container } = renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  const edge = container.querySelector('[data-plan-link="flow:first:second"]');
  if (!edge) throw new Error("Missing flow edge");
  fireEvent.click(edge);
  fireEvent.keyDown(grid(), { key: "Delete" });
  expect(links(container)).not.toContain("flow:first:second");
  expect(node("Reviewer")).toBeDefined();
  expect(node("Writer")).toBeDefined();
});

it("deletes a node with every connection it had and keeps the rest of the graph", async () => {
  const { container } = renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.deleteNode", { name: "Writer" }),
    }),
  );
  expect(within(grid()).queryByRole("article", { name: "Writer" })).toBeNull();
  expect(links(container)).toEqual(["flow:start:first", "data:first:ticket"]);
  for (const name of ["Start", "Reviewer", "Ende", "SYN-1: Open work", "spare"])
    expect(node(name)).toBeDefined();
});

it("saves the removal so that the reopened plan still lacks the node and its connections", async () => {
  const server = planServer();
  const first = renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.deleteNode", { name: "Writer" }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("plans.save") }));
  await waitFor(() => expect(server.saved).toHaveLength(1));
  await waitFor(() =>
    expect(screen.queryByText(i18n.t("plans.saveBeforePlay"))).toBeNull(),
  );
  first.unmount();
  const reopened = renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
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
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  const ticket = node("SYN-1: Open work");
  expect(
    within(ticket).queryByRole("button", { name: "Ablauf IN" }),
  ).toBeNull();
  expect(
    within(ticket).queryByRole("button", { name: "Ablauf OUT" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: i18n.t("plans.play") }),
  ).toHaveProperty("disabled", false);
  fireEvent.click(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.disconnect", { name: "ticket" }),
    }),
  );
  expect(links(container)).not.toContain("data:first:ticket");
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
  expect(links(container)).toContain("data:first:ticket");
  expect(ticket.className).not.toContain("border-destructive");
});

it("pans by dragging the empty grid and zooms with the wheel, keeping nodes and connections aligned", async () => {
  const { container } = renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  const reviewer = node("Reviewer");
  const position = [reviewer.style.left, reviewer.style.top];
  const curve = container
    .querySelector('[data-plan-link="flow:first:second"]')
    ?.getAttribute("d");
  fireEvent.pointerDown(grid(), {
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(grid(), { pointerId: 1, clientX: 160, clientY: 130 });
  fireEvent.pointerUp(grid(), { pointerId: 1, clientX: 160, clientY: 130 });
  expect(layer(container).style.transform).toBe(
    "translate(60px, 30px) scale(1)",
  );
  fireEvent.wheel(grid(), { deltaY: -200, clientX: 60, clientY: 30 });
  const zoomedIn = layer(container).style.transform;
  expect(zoomedIn).toMatch(/^translate\(60px, 30px\) scale\(1\.3\d*\)$/);
  fireEvent.wheel(grid(), { deltaY: 400, clientX: 60, clientY: 30 });
  expect(layer(container).style.transform).toMatch(
    /^translate\(60px, 30px\) scale\(0\.7\d*\)$/,
  );
  expect([reviewer.style.left, reviewer.style.top]).toEqual(position);
  expect(
    container
      .querySelector('[data-plan-link="flow:first:second"]')
      ?.getAttribute("d"),
  ).toBe(curve);
});

it("lays the graph over the whole work area and floats the side panel over it", async () => {
  renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.grid") });
  const canvas = screen.getByRole("region", { name: i18n.t("plans.canvas") });
  const panel = screen.getByRole("complementary", {
    name: i18n.t("plans.pickers"),
  });
  const area = canvas.parentElement;
  expect(area?.parentElement).toBe(panel.parentElement);
  expect(area?.className).toContain("h-[max(28rem,calc(100dvh-21rem))]");
  expect(canvas.className).toBe("absolute inset-0");
  expect(panel.className).toContain("lg:absolute");
  expect(panel.className).toContain("lg:top-2 lg:right-2");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.collapsePanel") }),
  );
  expect(canvas.className).toBe("absolute inset-0");
  expect(
    screen.getByRole("button", { name: i18n.t("plans.expandPanel") }),
  ).toBeDefined();
});
