import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanCompletionGateField } from "@/app/components/agents/plans/plan-completion-gate-field";
import { PlanStatusWork } from "@/app/components/agents/plans/plan-status-work";
import { createI18n } from "@/app/lib/i18n";
import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";

import type { AgentPlanStep, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanWorkView } from "@/definition/AgentPlanWork";

const node: AgentPlanStep = {
  id: "agent",
  type: "agent",
  agentId: "source",
  personalAgentId: null,
  instruction: "Work on SYN-162",
  bindings: {},
  x: 0,
  y: 0,
};
const work: AgentPlanWorkView = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  ticketId: "ticket",
  ticketKey: "SYN-162",
  statusKey: "in_progress",
  requirementsHash: "requirements",
  contentHash: "content",
  requiredChecks: ["focused"],
  issues: ["work_confirmation_stale"],
  items: [
    {
      id: "md-real",
      text: "Foreign independent task",
      checked: false,
      source: "description",
      order: 0,
      depth: 0,
      parentId: null,
    },
  ],
  record: {
    revision: 2,
    requirementsHash: "requirements",
    contentHash: "content",
    scopeHash: "scope",
    scope: [
      { itemId: "md-real", relevant: false, reason: "Independent assignment" },
    ],
    note: "Scope checked against current request",
    proofs: [],
    checks: [],
    confirmed: false,
  },
};

async function show(element: React.ReactElement): Promise<void> {
  const i18n = await createI18n("en");
  render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

it("keeps diagnostic nodes unchanged until the user explicitly enables the versioned gate", async () => {
  const change = vi.fn();
  await show(<PlanCompletionGateField step={node} onChange={change} />);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(change).toHaveBeenCalledWith({
    ...node,
    completion: "todos",
    completionGate: {
      version: 1,
      requiredChecks: ["pnpm run check", "pnpm run lint"],
    },
  });
});

it("edits multiple required check lines and removes only the opt-in when disabled", async () => {
  const change = vi.fn();
  const selected = {
    ...node,
    completion: "todos" as const,
    completionGate: { version: 1 as const, requiredChecks: ["check"] },
  };
  await show(<PlanCompletionGateField step={selected} onChange={change} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "check\nfocused regression" } });
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith({
    ...selected,
    completionGate: {
      version: 1,
      requiredChecks: ["check", "focused regression"],
    },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(change).toHaveBeenLastCalledWith({ ...node, completion: "todos" });
});

it("shows actual scope revision, explained foreign exclusions and missing check evidence without checkbox controls", async () => {
  await show(<PlanStatusWork work={[work]} />);
  expect(screen.getByText(/SYN-162.*scope revision 2/u)).toBeTruthy();
  expect(
    screen.getByText(/Outside this assignment.*Independent assignment/u),
  ).toBeTruthy();
  expect(screen.getByText(/Evidence missing/u)).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("displays confirmed required check evidence in the existing work details", async () => {
  if (!work.record) throw new Error("Expected a saved work scope");
  await show(
    <PlanStatusWork
      work={[
        {
          ...work,
          issues: [],
          record: {
            ...work.record,
            confirmed: true,
            checks: [
              {
                name: "focused",
                command: "pnpm run test:backend focused.unit.test.ts",
                exitCode: 0,
                evidence: "Focused regression passed",
              },
            ],
          },
        },
      ]}
    />,
  );
  expect(
    screen.getByText("Current work and required checks confirmed"),
  ).toBeTruthy();
  expect(screen.getByText(/Exit 0.*Focused regression passed/u)).toBeTruthy();
});

it("preserves scope and evidence across a real polling response after reload", () => {
  const run: AgentPlanRun = {
    id: "run",
    planId: "plan",
    planName: "Synthetic",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-10-27T18:00:00Z",
    status: "running",
    stopRequested: false,
    steps: [
      {
        id: "agent",
        name: "Synthetic",
        status: "running",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
        progress: {
          source: "live",
          observedAt: "2026-10-27T18:00:00Z",
          availability: "observed",
          todos: [],
          work: [work],
        },
      },
    ],
  };
  const response = readPlanPollingResponse({ ok: true, run });
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error("Expected a valid polling response");
  expect(response.run?.steps[0]?.progress?.work).toEqual([work]);
});
