import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusTodoCount } from "@/app/components/agents/plans/plan-status-todo-count";
import { PlanStatusAgentTodos } from "@/app/components/agents/plans/plan-status-agent-todos";
import { createI18n } from "@/app/lib/i18n";

import { runStep } from "../page72-run-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function view(step: AgentPlanStepResult): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("de")}>
      <PlanStatusTodoCount step={step} />
      <PlanStatusAgentTodos step={step} />
    </I18nextProvider>
  );
}

function ticketStep(done = 0): AgentPlanStepResult {
  return runStep("agent", {
    progress: {
      source: "live",
      availability: "observed",
      observedAt: "now",
      tickets: [{ id: "ticket", key: "PAGE-358", contentHash: "hash" }],
      todos: [1, 2, 3].map((number) => ({
        id: `ticket:${number}`,
        text: `Criterion ${number}`,
        status: number <= done ? "done" : "open",
        ticket: { id: "ticket", key: "PAGE-358", itemId: String(number) },
      })),
    },
  });
}

it("shows 0 / 3 TODOs and all ticket criteria immediately, then updates each mark", () => {
  const mounted = render(view(ticketStep()));
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "0 / 3 TODOs",
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  for (const done of [1, 2, 3]) {
    mounted.rerender(view(ticketStep(done)));
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      `${done} / 3 TODOs`,
    );
    expect(
      screen
        .getAllByRole("listitem")
        .filter((row) => row.textContent?.endsWith("Erledigt")),
    ).toHaveLength(done);
  }
});

it("counts instruction, ticket and agent-created TODOs together, keeping completed ones checked", () => {
  const step = ticketStep(1);
  const progress = step.progress;
  if (!progress) throw new Error("Missing fixture progress");
  render(
    view({
      ...step,
      progress: {
        ...progress,
        todos: [
          ...progress.todos,
          { id: "T4", text: "Instruction checkbox", status: "open" },
        ],
      },
      agentTodos: {
        attemptId: "attempt",
        updatedAt: "now",
        todos: [
          {
            id: "1",
            text: "Agent-created work",
            status: "active",
            updatedAt: "now",
          },
        ],
      },
    }),
  );
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "1 / 5 TODOs",
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(screen.getByText("Instruction checkbox")).toBeTruthy();
});

it("shows Keine TODOs for an empty step instead of an unknown counter", () => {
  render(view(runStep("agent")));
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Keine TODOs",
  );
  expect(screen.queryByText("— TODOs")).toBeNull();
  expect(screen.queryByRole("listitem")).toBeNull();
});
