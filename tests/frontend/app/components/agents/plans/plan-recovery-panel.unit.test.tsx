import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanRecoveryPanel,
  recoverableRunId,
} from "@/app/components/agents/plans/plan-recovery-panel";
import { PlanRecoveryResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume-dialog";

import {
  i18n,
  planControl,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "./plan-panel-fixture";

import type { PlanRecovery } from "./plan-panel-fixture";

function errorText(code: string): string {
  return i18n.t([
    `plans.recovery.error.${code}`,
    `settings.agents.error.${code}`,
    "plans.panel.error",
  ]);
}

function renderPanel(runId: string | null, recovery: PlanRecovery): void {
  renderTranslated(<PlanRecoveryPanel runId={runId} recovery={recovery} />);
}

function renderRestart(recovery: PlanRecovery): void {
  renderTranslated(
    <PlanRecoveryResumeDialog recovery={recovery} onClose={vi.fn()} />,
  );
}

it("selects the newest run for all states with recovery controls", () => {
  expect(recoverableRunId(undefined)).toBeNull();
  expect(recoverableRunId(planControl({ status: "failed" }))).toBeNull();
  expect(
    recoverableRunId(planControl({ status: "idle", runId: "run" })),
  ).toBeNull();
  for (const status of [
    "running",
    "pausing",
    "paused",
    "succeeded",
    "failed",
    "cancelled",
    "stopping",
  ] as const)
    expect(recoverableRunId(planControl({ status, runId: "run" }))).toBe("run");
});

it("shows nothing without a run, while loading, or for another person's run", () => {
  renderPanel(null, recoveryState({ view: recoveryView() }));
  renderPanel("run", recoveryState());
  renderPanel("run", recoveryState({ error: "access_denied" }));
  renderPanel("run", recoveryState({ error: "plan_access_denied" }));
  expect(document.body.textContent).toBe("");
});

it("names why the recovery view could not be read", () => {
  renderPanel("run", recoveryState({ error: "workflow_unavailable" }));
  expect(screen.getByRole("alert").textContent).toBe(
    errorText("workflow_unavailable"),
  );
});

it("shows the recovery state and refusal and requires confirmation before restarting", async () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => null);
  renderRestart(
    recoveryState({
      view: recoveryView({ restart: { available: true, reason: null } }),
      error: "synthetic_unknown",
      submit,
    }),
  );
  expect(
    screen.getByRole("dialog", { name: i18n.t("plans.recovery.restart") }),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.recovery.state.recoverable")),
  ).toBeDefined();
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.panel.error"),
  );
  const restart = screen.getByRole("button", {
    name: i18n.t("plans.recovery.restartAction"),
  });
  expect(restart.hasAttribute("disabled")).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: i18n.t("plans.recovery.confirmRepeat"),
    }),
  );
  fireEvent.click(restart);
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: "restart",
      revision: 3,
      confirmRepeat: true,
      reviewedStepIds: [],
    }),
  );
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.recovery.releaseAction"),
    }),
  ).toBeNull();
});

it("disables restart and closing while a decision is pending", () => {
  renderRestart(
    recoveryState({
      view: recoveryView({ restart: { available: true, reason: null } }),
      isPending: true,
    }),
  );
  expect(
    screen
      .getByRole("button", {
        name: i18n.t("plans.recovery.restartAction"),
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: i18n.t("settings.agents.cancel") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("names the affected resource and safe retry when a cleanup scan is denied", () => {
  renderRestart(
    recoveryState({
      view: recoveryView(),
      error: "cleanup_unconfirmed",
      cleanupFailure: {
        stepId: "first",
        kind: "local_session",
        reason: "scan_access_denied",
      },
    }),
  );
  const message = screen.getByRole("alert").textContent;
  expect(message).toContain("Reviewer");
  expect(message).toContain(i18n.t("plans.recovery.cleanupKind.local_session"));
  expect(message).toContain(
    i18n.t("plans.recovery.cleanupFailure.scan_access_denied", {
      step: "Reviewer",
      resource: i18n.t("plans.recovery.cleanupKind.local_session"),
    }),
  );
});
