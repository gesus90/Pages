import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusTodos } from "@/app/components/agents/plans/plan-status-todos";
import { createI18n } from "@/app/lib/i18n";

import { runStep } from "../page72-run-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanProgress,
  AgentPlanProgressItem,
} from "@/definition/AgentPlanProgress";

const i18n = createI18n("en");
const TICKET = { id: "ticket", key: "SYN-35", contentHash: "hash" };

function item(
  index: number,
  status: AgentPlanProgressItem["status"],
  isTicketItem = true,
): AgentPlanProgressItem {
  return {
    id: isTicketItem ? `ticket:item-${index}` : `T${index}`,
    text: `Work ${index}`,
    status,
    ...(isTicketItem
      ? { ticket: { id: "ticket", key: "SYN-35", itemId: `item-${index}` } }
      : {}),
  };
}

function show(progress?: AgentPlanProgress): void {
  const step: AgentPlanStepResult = runStep("agent", {
    name: "Ticket agent",
    ...(progress ? { progress } : {}),
  });
  render(
    <I18nextProvider i18n={i18n}>
      <PlanStatusTodos step={step} number={3} />
    </I18nextProvider>,
  );
}

it("says that no list was reported for a step without progress", () => {
  show();
  const section = screen.getByRole("region", { name: "TODOs" });
  expect(within(section).getByText("Ticket agent · Step 3")).toBeTruthy();
  expect(
    within(section).getAllByText("No TODO list was reported for this step."),
  ).toHaveLength(2);
  expect(screen.queryByRole("list")).toBeNull();
});

it("confirms observed ticket items and marks each state", () => {
  show({
    source: "live",
    observedAt: "2026-10-28T00:00:00Z",
    availability: "observed",
    tickets: [TICKET],
    todos: [item(0, "done"), item(1, "active"), item(2, "open")],
  });
  expect(screen.getByRole("region", { name: "TODOs · SYN-35" })).toBeTruthy();
  expect(
    screen.getByText(
      "Current observed ticket state · unweighted checklist progress",
    ),
  ).toBeTruthy();
  const rows = screen.getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Work 0Done",
    `Work 1${i18n.t("plans.progress.todoState.active")}`,
    "Work 2Up next",
  ]);
  expect(rows[1]?.className).toContain("bg-status-active-subtle");
  expect(screen.queryByText("No TODO list was reported for this step.")).toBe(
    null,
  );
});

it("shows unknown ticket items with a help mark and without a confirmed count", () => {
  show({
    source: "historical",
    observedAt: "2026-10-28T00:00:00Z",
    availability: "observed",
    tickets: [TICKET],
    todos: [item(0, "missing"), item(1, "unreported")],
  });
  expect(screen.getByText("Saved TODO list of this step")).toBeTruthy();
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.querySelectorAll("svg")).toHaveLength(1);
  expect(
    screen.getByText("No TODO list was reported for this step."),
  ).toBeTruthy();
});

it("lists contract items of a live step without tickets as tasks of the step", () => {
  show({
    source: "live",
    observedAt: "2026-10-28T00:00:00Z",
    availability: "observed",
    todos: [item(1, "open", false)],
  });
  expect(
    screen.getByText("Tasks of this step · progress not reported yet"),
  ).toBeTruthy();
  expect(screen.getByRole("listitem").textContent).toBe("Work 1Up next");
});

it("tells an observed empty list apart from an unavailable one", () => {
  show({
    source: "historical",
    observedAt: "2026-10-28T00:00:00Z",
    availability: "observed",
    todos: [],
  });
  expect(screen.getByText("No work list yet.")).toBeTruthy();
});

it("treats an unavailable reading as no reported list", () => {
  show({
    source: "historical",
    observedAt: "2026-10-28T00:00:00Z",
    availability: "unavailable",
    todos: [],
  });
  expect(screen.queryByText("No work list yet.")).toBeNull();
  expect(
    screen.getAllByText("No TODO list was reported for this step."),
  ).toHaveLength(2);
});
