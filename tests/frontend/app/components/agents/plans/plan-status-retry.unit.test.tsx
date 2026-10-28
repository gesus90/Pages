import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusRetry } from "@/app/components/agents/plans/plan-status-retry";
import { createI18n } from "@/app/lib/i18n";

import { syntheticSession } from "../page72-run-fixture";

import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";
import type { RenderResult } from "@testing-library/react";

const i18n = createI18n("en");
const RESET = "2026-10-28T10:00:00.000Z";
const NEXT = "2026-10-28T10:01:00.000Z";
const ENDED = "2026-10-28T09:59:00.000Z";

function show(retry?: AgentPlanRetry): RenderResult {
  const session = { ...syntheticSession(), ...(retry ? { retry } : {}) };
  return render(
    <I18nextProvider i18n={i18n}>
      <PlanStatusRetry session={session} />
    </I18nextProvider>,
  );
}

function localTime(instant: string): string {
  return new Date(instant).toLocaleString("en");
}

it("renders nothing for a session that never waited for a retry", () => {
  const { container } = show();
  expect(container.innerHTML).toBe("");
});

it("shows the waiting reason, the bounded count, the last cause and both deadlines", () => {
  show({
    state: "waiting",
    reason: "quota",
    nextAttemptAt: NEXT,
    resetAt: RESET,
    attempts: Array.from({ length: 12 }, (_, index) => ({
      attemptId: `attempt-${index}`,
      sessionId: null,
      endedAt: ENDED,
      code: "provider_quota_exhausted" as const,
    })),
  });
  const status = screen.getByRole("status");
  expect(screen.getByText("Waiting for automatic retry")).toBeTruthy();
  expect(status.textContent).toContain("The quota is exhausted.");
  expect(screen.getByText("Retries: 10 of 10")).toBeTruthy();
  expect(status.textContent).toContain("Last failure:");
  expect(screen.getByText(`Reported reset: ${localTime(RESET)}`)).toBeTruthy();
  expect(screen.getByText(`Next attempt: ${localTime(NEXT)}`)).toBeTruthy();
  expect(status.querySelectorAll("li")).toHaveLength(12);
});

it("keeps a completed retry's history without promising further attempts", () => {
  show({
    state: "completed",
    reason: "transient",
    nextAttemptAt: null,
    resetAt: null,
    attempts: [
      {
        attemptId: null,
        sessionId: null,
        endedAt: ENDED,
        code: "provider_unreachable",
      },
    ],
  });
  expect(screen.getByText("Completed after retry")).toBeTruthy();
  expect(
    screen.getByText(
      "The node completed successfully. Earlier failures remain in its history.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Reported reset/u)).toBeNull();
  expect(screen.queryByText(/Next attempt/u)).toBeNull();
  expect(screen.getByRole("listitem").textContent).toContain(localTime(ENDED));
});

it("omits the last cause before any attempt failed", () => {
  show({
    state: "blocked",
    reason: "reset_unknown",
    nextAttemptAt: null,
    resetAt: null,
    attempts: [],
  });
  expect(screen.getByText("Automatic retry blocked")).toBeTruthy();
  expect(screen.getByText("Retries: 0 of 10")).toBeTruthy();
  expect(screen.queryByText(/Last failure/u)).toBeNull();
  expect(screen.queryByRole("listitem")).toBeNull();
});
