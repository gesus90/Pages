import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanCanvas } from "@/app/components/agents/plans/plan-canvas";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";

import { i18n, SOURCES, syntheticPlan } from "./page61-plan-fixture";
import { runStep, syntheticRun } from "./page72-run-fixture";

import type { AgentPlanRun, AgentPlanSources } from "@/definition/AgentPlan";

function Canvas({
  canEdit = true,
  run = null,
  sources = SOURCES,
  onEdit = vi.fn(),
}: {
  readonly canEdit?: boolean;
  readonly run?: AgentPlanRun | null;
  readonly sources?: AgentPlanSources;
  readonly onEdit?: (id: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(syntheticPlan);
  const graph = usePlanGraph(draft, setDraft, sources);
  return (
    <I18nextProvider i18n={i18n}>
      <PlanCanvas
        draft={draft}
        sources={sources}
        graph={graph}
        canEdit={canEdit}
        run={run}
        onEdit={onEdit}
      />
    </I18nextProvider>
  );
}

function node(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}

async function openActions(name: string): Promise<void> {
  fireEvent.keyDown(
    within(node(name)).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name }),
    }),
    { key: "Enter" },
  );
  await screen.findByRole("menu");
}

it("offers removal only in the three-dot menu and removes a ticket with its data connection", async () => {
  const mounted = render(<Canvas />);
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.delete"),
    }),
  ).toBeNull();
  await openActions("SYN-1: Open work");
  expect(
    screen.queryByRole("menuitem", { name: i18n.t("settings.agents.edit") }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: i18n.t("plans.delete"),
    }),
  );
  expect(
    screen.queryByRole("article", { name: "SYN-1: Open work" }),
  ).toBeNull();
  expect(
    mounted.container.querySelector('[data-plan-link="data:first:ticket"]'),
  ).toBeNull();
  expect(node("Reviewer")).toBeDefined();
});

it("opens the existing agent editor from its edit button and keeps Delete inside a control from deleting the node", async () => {
  const onEdit = vi.fn();
  render(<Canvas onEdit={onEdit} />);
  const select = within(node("Reviewer")).getByRole("button", {
    name: i18n.t("plans.selectNode", { name: "Reviewer" }),
  });
  fireEvent.click(select);
  // Only the grid and the handle of the selected node delete; other controls keep the key.
  fireEvent.keyDown(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Reviewer" }),
    }),
    { key: "Delete" },
  );
  expect(node("Reviewer")).toBeDefined();
  fireEvent.click(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Reviewer" }),
    }),
  );
  expect(onEdit).toHaveBeenCalledWith("first");
});

it("keeps mutation menus disabled for read-only plans", async () => {
  render(<Canvas canEdit={false} />);
  for (const name of ["Start", "Ende", "SYN-1: Open work", "spare"])
    expect(
      within(node(name)).getByRole("button", {
        name: i18n.t("settings.agents.actionsFor", { name }),
      }),
    ).toHaveProperty("disabled", true);
  // An agent locks its menu, but keeps the edit button for the read-only node dialog.
  expect(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Reviewer" }),
    }),
  ).toHaveProperty("disabled", true);
  expect(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Reviewer" }),
    }),
  ).toHaveProperty("disabled", false);
});

it("disables an already open action menu when editing becomes unavailable", async () => {
  const mounted = render(<Canvas />);
  await openActions("Reviewer");
  mounted.rerender(<Canvas canEdit={false} />);
  // Every mutation is disabled; the read-only node dialog stays reachable from the edit button.
  for (const item of screen.getAllByRole("menuitem"))
    expect(item.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: i18n.t("plans.delete"),
    }),
  );
  expect(
    mounted.container.querySelector('article[aria-label="Reviewer"]'),
  ).not.toBeNull();
});

it("renders compact rounded endpoints, retains their ports and colors only completed checkpoints green", async () => {
  const run = {
    ...syntheticRun(),
    steps: [
      runStep("start", { status: "succeeded" }),
      runStep("end", { status: "failed" }),
    ],
  };
  const mounted = render(<Canvas run={run} />);
  const start = node("Start");
  const end = node("Ende");
  expect(
    Number.parseInt(
      (start.closest(".react-flow__node") as HTMLElement).style.width,
    ),
  ).toBeLessThan(100);
  const startButton = within(start).getByRole("button", {
    name: i18n.t("plans.selectNode", { name: "Start" }),
  });
  expect(startButton.className).toContain("rounded-2xl");
  expect(startButton.className).toContain("text-success");
  expect(
    within(end).getByRole("button", {
      name: i18n.t("plans.selectNode", { name: "Ende" }),
    }).className,
  ).toContain("text-muted-foreground");
  fireEvent.click(
    within(start).getByRole("button", { name: i18n.t("plans.flowOut") }),
  );
  expect(
    within(node("Reviewer")).getByRole("button", {
      name: i18n.t("plans.flowIn"),
    }),
  ).toHaveProperty("disabled", false);
  await waitFor(() =>
    expect(
      mounted.container.querySelector(
        '.react-flow__edge[data-id="flow:start:first"]',
      ),
    ).not.toBeNull(),
  );
});

it("keeps type tints while agent execution statuses change", () => {
  const run = syntheticRun();
  const mounted = render(
    <Canvas
      run={{ ...run, steps: [runStep("first", { status: "running" })] }}
    />,
  );
  expect(node("Reviewer").className).toContain("bg-plan-agent-subtle");
  expect(node("SYN-1: Open work").className).toContain("bg-plan-ticket-subtle");
  expect(node("spare").className).toContain("bg-plan-parameter-subtle");
  expect(
    within(node("Reviewer")).getByText(i18n.t("plans.status.running"))
      .parentElement?.className,
  ).toContain("text-status-active");
  mounted.rerender(
    <Canvas
      run={{ ...run, steps: [runStep("first", { status: "failed" })] }}
    />,
  );
  expect(node("Reviewer").className).toContain("bg-plan-agent-subtle");
  expect(
    within(node("Reviewer")).getByText(i18n.t("plans.status.failed"))
      .parentElement?.className,
  ).toContain("text-destructive");
});

it("reflects ticket workflow updates without changing the orange ticket type", () => {
  const mounted = render(<Canvas />);
  const label = "SYN-1: Open work";
  expect(
    within(node(label)).getByText(i18n.t("plans.status.waiting")),
  ).toBeDefined();
  const active = {
    ...SOURCES,
    tasks: SOURCES.tasks.map((task) =>
      task.id === "1" ? { ...task, statusKey: "in_progress" } : task,
    ),
  };
  mounted.rerender(<Canvas sources={active} />);
  expect(
    within(node(label)).getByText(i18n.t("plans.status.running")),
  ).toBeDefined();
  const done = {
    ...SOURCES,
    tasks: SOURCES.tasks.map((task) => ({ ...task, isDone: true })),
  };
  mounted.rerender(<Canvas sources={done} />);
  expect(
    within(node(label)).getByText(i18n.t("plans.status.succeeded")),
  ).toBeDefined();
  expect(node(label).className).toContain("bg-plan-ticket-subtle");
});
