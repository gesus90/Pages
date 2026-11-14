import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusTodoCount } from "@/app/components/agents/plans/plan-status-todo-count";
import { PlanStatusAgentTodos } from "@/app/components/agents/plans/plan-status-agent-todos";
import { agentTodoSummary } from "@/app/components/agents/plans/plan-agent-todo-model";
import { createI18n } from "@/app/lib/i18n";

import { runStep, syntheticSession } from "../page72-run-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

function codexStep(status: AgentPlanAgentTodo["status"]): AgentPlanStepResult {
  return runStep("agent", {
    session: {
      ...syntheticSession(),
      runner: "codex_cli",
      contract: { todos: [], criteria: [], tickets: [] },
    },
    progress: {
      source: "live",
      availability: "observed",
      observedAt: "now",
      tickets: [],
      todos: [{ id: "T1", text: "Create a.txt", status: "done" }],
    },
    agentTodos: {
      attemptId: "iteration-1",
      updatedAt: "now",
      todos: [{ id: "1", text: "Create a.txt", status, updatedAt: "now" }],
    },
  });
}

function view(step: AgentPlanStepResult): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("de")}>
      <PlanStatusTodoCount step={step} />
      <PlanStatusAgentTodos step={step} />
    </I18nextProvider>
  );
}

it("shows native Codex TODO changes even when the ticket was already checked, including the collapsed counter", () => {
  const mounted = render(view(codexStep("open")));
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "0 / 1 TODOs",
  );
  mounted.rerender(view(codexStep("active")));
  expect(agentTodoSummary(codexStep("active")).current?.text).toBe(
    "Create a.txt",
  );
  mounted.rerender(view(codexStep("done")));
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "1 / 1 TODOs",
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});

it("retains the established completed assignment display for Claude", () => {
  const step = codexStep("open");
  const session = step.session;
  if (!session) throw new Error("Missing fixture session");
  expect(
    agentTodoSummary({
      ...step,
      session: { ...session, runner: "claude_code" },
    }).done,
  ).toBe(1);
});

it("counts only actual work when a previous completion check asked for the native plan", () => {
  const step = codexStep("done");
  const progress = step.progress;
  if (!progress) throw new Error("Missing fixture progress");
  const summary = agentTodoSummary({
    ...step,
    progress: {
      ...progress,
      todos: [
        ...progress.todos,
        { id: "PAGES_PLAN", text: "Create native plan", status: "open" },
      ],
    },
  });
  expect(summary).toMatchObject({ done: 1, total: 1 });
});
