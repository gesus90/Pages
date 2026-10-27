import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  collectToasts,
  i18n,
  planServer,
  pressSave,
  renderPlanPage,
  syntheticPlan,
} from "./page61-plan-fixture";

// The former editor controls stay outside the canvas; PAGE-106 floats run actions beside it.
const REMOVED_CONTROLS = [
  "Plan speichern",
  "Play",
  "Pause",
  "Stop",
  "Neuer Plan",
  "Plan löschen",
  "Gespeicherten Plan auswählen",
  "Hilfe zum Planraster",
];
const REMOVED_AREAS = [
  "Plankonfiguration",
  "Quellen und Auswahl",
  "Ablauf und Details",
];

const scrollIntoView = HTMLElement.prototype.scrollIntoView;
const offsetSizes = ["offsetWidth", "offsetHeight"] as const;
const measured = offsetSizes.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // A canvas of a real window size, so fitting and zooming have room to work.
  for (const [name, size] of [
    ["offsetWidth", 1600],
    ["offsetHeight", 1000],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => size,
    });
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  offsetSizes.forEach((name, index) => {
    const descriptor = measured[index];
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
  });
});

function canvas(): HTMLElement {
  return screen.getByRole("region", { name: i18n.t("plans.canvas") });
}

function edges(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll(".react-flow__edge")];
}

async function ready(container: HTMLElement): Promise<void> {
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  await waitFor(() => expect(edges(container)).not.toHaveLength(0));
}

function viewportZoom(container: HTMLElement): number {
  const transform =
    container.querySelector<HTMLElement>(".react-flow__viewport")?.style
      .transform ?? "";
  const scale = /scale\(([\d.]+)\)/.exec(transform)?.[1];
  if (!scale) throw new Error(`No zoom in "${transform}"`);
  return Number(scale);
}

function zoomBar(): HTMLElement {
  return screen.getByRole("toolbar", { name: i18n.t("plans.flow.tools") });
}

function shownZoom(): string {
  return (
    within(zoomBar()).getByRole("status", { name: i18n.t("plans.zoomLevel") })
      .textContent ?? ""
  );
}

function card(name: string): HTMLElement {
  return within(canvas()).getByRole("article", { name });
}

async function removeWriter(): Promise<void> {
  fireEvent.keyDown(
    within(card("Writer")).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Writer" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.delete"),
    }),
  );
}

it("keeps the canvas with its nodes, connections and one zoom bar free of plan controls", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  for (const name of REMOVED_CONTROLS)
    expect(within(canvas()).queryByRole("button", { name })).toBeNull();
  for (const name of REMOVED_AREAS)
    expect(screen.queryByRole("region", { name })).toBeNull();
  expect(
    screen
      .getAllByRole("complementary")
      .map((panel) => panel.getAttribute("aria-label")),
  ).toEqual([i18n.t("plans.palette.label")]);
  // Only the palette has tabs, Nodes and Templates (PAGE-117); no side panel returns.
  expect(
    screen
      .queryAllByRole("tab")
      .filter((tab) => !tab.closest("[data-plan-palette]")),
  ).toHaveLength(0);
  // Node cards edit their own fields in place (PAGE-108); the canvas around them has no selects.
  expect(
    screen
      .queryAllByRole("combobox")
      .filter((field) => !field.closest(".react-flow__node")),
  ).toHaveLength(0);
  expect(
    container.querySelector(
      ".react-flow__minimap, .react-flow__controls, .react-flow__attribution",
    ),
  ).toBeNull();
  expect(container.textContent).not.toContain("React Flow");
  expect(screen.getAllByRole("toolbar")).toHaveLength(1);
  expect(
    within(zoomBar())
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    i18n.t("plans.zoomOut"),
    i18n.t("plans.zoomIn"),
    i18n.t("plans.flow.fitView"),
  ]);
  expect(zoomBar().closest(".absolute")?.className).toContain(
    "absolute inset-4",
  );
  expect(card("Reviewer")).toBeDefined();
  // The page keeps a heading for assistive technology without showing a title.
  expect(screen.getByRole("heading", { level: 1 }).className).toBe("sr-only");
});

it("zooms out, in and to fit from the bar and always shows the zoom the canvas really has", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const fit = within(zoomBar()).getByRole("button", {
    name: i18n.t("plans.flow.fitView"),
  });
  // Fitting shrinks the measured graph into the canvas and never enlarges it.
  // The synthetic measurements arrive a tick after rendering, and React Flow
  // fits once it has them.
  await new Promise((resolve) => setTimeout(resolve, 20));
  fireEvent.click(fit);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fitted = viewportZoom(container);
  expect(fitted).toBeLessThan(1);
  expect(shownZoom()).toBe(`${Math.round(fitted * 100)} %`);
  fireEvent.click(
    within(zoomBar()).getByRole("button", { name: i18n.t("plans.zoomIn") }),
  );
  await waitFor(() =>
    expect(viewportZoom(container)).toBeCloseTo(fitted * 1.2, 5),
  );
  expect(shownZoom()).toBe(`${Math.round(fitted * 120)} %`);
  for (let step = 0; step < 2; step++)
    fireEvent.click(
      within(zoomBar()).getByRole("button", { name: i18n.t("plans.zoomOut") }),
    );
  await waitFor(() =>
    expect(viewportZoom(container)).toBeCloseTo((fitted * 1.2) / 1.44, 5),
  );
  expect(shownZoom()).toBe(`${Math.round(viewportZoom(container) * 100)} %`);
  fireEvent.wheel(container.querySelector(".react-flow__pane") ?? canvas(), {
    deltaY: -200,
  });
  await waitFor(() =>
    expect(shownZoom()).toBe(`${Math.round(viewportZoom(container) * 100)} %`),
  );
  fireEvent.click(fit);
  await waitFor(() => expect(viewportZoom(container)).toBeCloseTo(fitted, 5));
  expect(shownZoom()).toBe(`${Math.round(fitted * 100)} %`);
});

it("disables zooming in at the largest zoom", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const zoomIn = within(zoomBar()).getByRole("button", {
    name: i18n.t("plans.zoomIn"),
  });
  for (let step = 0; step < 40 && !zoomIn.hasAttribute("disabled"); step++)
    fireEvent.click(zoomIn);
  await waitFor(() => expect(zoomIn).toHaveProperty("disabled", true));
  expect(viewportZoom(container)).toBe(2);
  expect(shownZoom()).toBe("200 %");
});

it("draws flow and data connections only as Bezier curves", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const paths = [
    ...container.querySelectorAll<SVGPathElement>(
      ".react-flow__edge path.react-flow__edge-path",
    ),
  ];
  expect(paths).toHaveLength(5);
  for (const path of paths)
    expect(path.getAttribute("d")).toMatch(/^M[-\d.,\s]+C[-\d.,\s]+$/);
  // Data bindings stay dashed beside the solid flow, so both kinds are covered.
  expect(
    paths.filter((path) => path.style.strokeDasharray === "6 5"),
  ).toHaveLength(2);
});

it("previews a connection being dragged from a data port as a Bezier curve", async () => {
  // jsdom has no hit testing; the drag ends over no port.
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => null,
  });
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const handle = card("spare")
    .closest(".react-flow__node")
    ?.querySelector('.react-flow__handle[data-handleid="value-out"]');
  if (!handle) throw new Error("Missing value port");
  fireEvent.mouseDown(handle, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
  const preview = await waitFor(() => {
    const path = container.querySelector(".react-flow__connectionline path");
    if (!path) throw new Error("No connection preview");
    return path;
  });
  expect(preview.getAttribute("d")).toMatch(/^M[-\d.,\s]+C[-\d.,\s]+$/);
  expect(preview.getAttribute("stroke-dasharray")).toBe("6 5");
  fireEvent.mouseUp(document, { clientX: 400, clientY: 300 });
  Reflect.deleteProperty(document, "elementFromPoint");
});

it("saves changes with Ctrl+S and confirms an unchanged plan with Cmd+S without saving again", async () => {
  const server = planServer();
  const toasts = collectToasts();
  const { container } = renderPlanPage(server);
  await ready(container);
  await removeWriter();
  const shortcut = new KeyboardEvent("keydown", {
    key: "s",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  canvas().dispatchEvent(shortcut);
  // The browser's own page save never opens.
  expect(shortcut.defaultPrevented).toBe(true);
  await waitFor(() => expect(server.saved).toHaveLength(1));
  expect(server.saved[0]?.nodes.map((node) => node.id)).not.toContain("second");
  await waitFor(() => expect(toasts).toEqual([i18n.t("plans.saved")]));
  pressSave("meta");
  await waitFor(() => expect(toasts).toHaveLength(2));
  expect(server.saved).toHaveLength(1);
});

it("saves once for a held key and ignores Ctrl+Shift+S", async () => {
  const server = planServer();
  const { container } = renderPlanPage(server);
  await ready(container);
  await removeWriter();
  fireEvent.keyDown(document.body, { key: "s", ctrlKey: true, repeat: true });
  fireEvent.keyDown(document.body, { key: "S", ctrlKey: true, shiftKey: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(server.saved).toHaveLength(0);
});

it("keeps a refused save visible until it is closed", async () => {
  const server = planServer();
  // A revision conflict opens its own dialog; any other refusal stays in the notice.
  server.failure = "plan_name_taken";
  const { container } = renderPlanPage(server);
  await ready(container);
  await removeWriter();
  pressSave();
  const notices = within(zoomBar().parentElement ?? document.body);
  const alert = await notices.findByRole("alert");
  expect(alert.textContent).toContain(i18n.t("plans.flow.storage.failed"));
  expect(alert.textContent).toContain(
    i18n.t("settings.agents.error.plan_name_taken"),
  );
  fireEvent.click(
    within(alert).getByRole("button", {
      name: i18n.t("plans.groups.closeNotice"),
    }),
  );
  expect(notices.queryByRole("alert")).toBeNull();
  expect(server.saved).toHaveLength(0);
});

it("opens the revision conflict dialog when the save is refused because the plan changed", async () => {
  const server = planServer();
  server.failure = "plan_conflict";
  const { container } = renderPlanPage(server);
  await ready(container);
  await removeWriter();
  pressSave();
  expect(
    await screen.findByRole("dialog", {
      name: i18n.t("plans.execution.conflictTitle"),
    }),
  ).toBeDefined();
  expect(server.saved).toHaveLength(0);
});

it("names a read-only plan on Ctrl+S and saves nothing", async () => {
  const server = planServer(false);
  const { container } = renderPlanPage(server);
  await ready(container);
  pressSave();
  expect(
    await within(zoomBar().parentElement ?? document.body).findByText(
      i18n.t("plans.flow.storage.readOnly"),
    ),
  ).toBeDefined();
  expect(server.saved).toHaveLength(0);
});

it("opens the PageAgentCLI console of an agent only on a double click", async () => {
  const { container } = renderPlanPage(planServer());
  await ready(container);
  const name = i18n.t("plans.console.label", { name: "Reviewer" });
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  const handle = within(card("Reviewer")).getByRole("button", {
    name: i18n.t("plans.selectNode", { name: "Reviewer" }),
  });
  fireEvent.click(handle);
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  fireEvent.doubleClick(handle);
  expect(await screen.findByRole("dialog", { name })).toBeDefined();
});

it("leaves the canvas empty and says why when the default plan cannot be opened", async () => {
  const server = planServer();
  renderPlanPage(server, "/agents/plans");
  expect(
    await screen.findByText(i18n.t("plans.opening.defaultMissingTitle")),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.opening.defaultMissing", { name: "Task2" })),
  ).toBeDefined();
  expect(within(canvas()).queryAllByRole("article")).toHaveLength(0);
  expect(zoomBar()).toBeDefined();
  pressSave();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(server.saved).toHaveLength(0);
});

it("leaves the canvas empty for a requested plan that is missing or hidden", async () => {
  const server = planServer();
  server.plan = null;
  renderPlanPage(server);
  expect(
    await screen.findByText(i18n.t("plans.opening.requestedMissingTitle")),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.opening.requestedMissing")),
  ).toBeDefined();
  expect(within(canvas()).queryAllByRole("article")).toHaveLength(0);
});

it("says that an opened plan has no nodes yet", async () => {
  const server = planServer();
  server.plan = { ...syntheticPlan(), nodes: [], edges: [] };
  renderPlanPage(server);
  expect(
    await screen.findByText(i18n.t("plans.opening.emptyPlan")),
  ).toBeDefined();
});
