import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusWork } from "@/app/components/agents/plans/plan-status-work";
import { createI18n } from "@/app/lib/i18n";

import type { AgentPlanWorkView } from "@/definition/AgentPlanWork";

const i18n = createI18n("en");

const VIEW: AgentPlanWorkView = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  ticketId: "ticket",
  ticketKey: "SYN-35",
  statusKey: "in_progress",
  requirementsHash: "requirements",
  contentHash: "content",
  requiredChecks: ["lint", "test"],
  issues: [],
  items: [
    {
      id: "known",
      text: "Known item",
      checked: true,
      source: "description",
      order: 0,
      depth: 0,
      parentId: null,
    },
  ],
  record: {
    revision: 4,
    requirementsHash: "requirements",
    contentHash: "content",
    scopeHash: "scope",
    scope: [
      { itemId: "known", relevant: true, reason: "" },
      { itemId: "gone", relevant: false, reason: "Removed upstream" },
    ],
    note: "Checked against the ticket",
    proofs: [
      { itemId: "known", evidence: "Shown in review" },
      { itemId: "gone", evidence: "Old proof" },
    ],
    checks: [
      { name: "test", command: "pnpm test", exitCode: 1, evidence: "Failed" },
    ],
    confirmed: true,
  },
};

function show(work: readonly AgentPlanWorkView[] | undefined): HTMLElement {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <PlanStatusWork work={work} />
    </I18nextProvider>,
  );
  return container;
}

it("renders nothing without saved work", () => {
  expect(show(undefined).innerHTML).toBe("");
  expect(show([]).innerHTML).toBe("");
});

it("names unknown excluded items and proofs by their identifier", () => {
  show([VIEW]);
  expect(screen.getByText("Work SYN-35 · scope revision 4")).toBeTruthy();
  expect(screen.getByText("Checked against the ticket")).toBeTruthy();
  expect(
    screen.getByText("Outside this assignment: gone · Removed upstream"),
  ).toBeTruthy();
  expect(screen.getByText("Known item: Shown in review")).toBeTruthy();
  expect(screen.getByText("gone: Old proof")).toBeTruthy();
  expect(screen.getByText("lint · Evidence missing")).toBeTruthy();
  expect(screen.getByText("test · pnpm test · Exit 1 · Failed")).toBeTruthy();
});

it("shows a pending gate without a saved record at revision zero", () => {
  show([{ ...VIEW, issues: ["work_confirmation_missing"], record: null }]);
  expect(screen.getByText("Work SYN-35 · scope revision 0")).toBeTruthy();
  expect(screen.getByText("Completion check pending or stale")).toBeTruthy();
  expect(screen.queryByText("Checked against the ticket")).toBeNull();
  expect(screen.getByText("test · Evidence missing")).toBeTruthy();
});
