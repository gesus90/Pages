import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryResume } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume";

import {
  i18n,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "../plan-panel-fixture";

import type { PlanRecovery } from "../plan-panel-fixture";
import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";

const RESUMABLE = recoveryView({
  resume: {
    available: true,
    reason: null,
    modes: [
      { mode: "native_resume", available: false },
      { mode: "new_session", available: true },
    ],
    reusedStepIds: ["first", "unnamed"],
    reviewStepIds: ["second", "other"],
  },
});

function renderResume(
  view: AgentPlanRecoveryView,
  recoveryOverrides: Partial<PlanRecovery> = {},
): { onClose: ReturnType<typeof vi.fn>; recovery: PlanRecovery } {
  const onClose = vi.fn();
  const recovery = recoveryState({ view, ...recoveryOverrides });
  renderTranslated(
    <PlanRecoveryResume view={view} recovery={recovery} onClose={onClose} />,
  );
  return { onClose, recovery };
}

function resumeButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.recovery.resumeAction"),
  });
}

function cancelButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("settings.agents.cancel"),
  });
}

it("renders confirmation prompt and submits resume action on continue", async () => {
  const submit = vi.fn(async () => ({
    commandId: "cmd-1",
    revision: 3,
    outcome: "started" as const,
    runId: "run-resumed",
  }));
  const { onClose } = renderResume(RESUMABLE, { submit });

  expect(screen.getByText(i18n.t("plans.recovery.resumeTitle"))).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.recovery.resumeConfirm")),
  ).toBeDefined();
  expect(resumeButton().hasAttribute("disabled")).toBe(false);

  fireEvent.click(resumeButton());

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(submit).toHaveBeenCalledWith({
    action: "resume",
    confirmContinue: true,
    revision: 3,
  });
});

it("disables continue and shows blocker reason when resume is unavailable", () => {
  const blockedView = recoveryView({
    resume: {
      available: false,
      reason: "plan_run_active",
      modes: [],
      reusedStepIds: [],
      reviewStepIds: [],
    },
  });
  renderResume(blockedView);

  expect(resumeButton().hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByText(i18n.t("plans.recovery.blocker.plan_run_active")),
  ).toBeDefined();
});

it("disables cancel and shows pending status while request is in flight", () => {
  const { onClose } = renderResume(RESUMABLE, { isPending: true });

  expect(cancelButton().hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByText(i18n.t("plans.recovery.resumePending")),
  ).toBeDefined();

  fireEvent.click(cancelButton());
  expect(onClose).not.toHaveBeenCalled();
});

it("closes dialog when cancel button is clicked", () => {
  const { onClose } = renderResume(RESUMABLE);

  fireEvent.click(cancelButton());
  expect(onClose).toHaveBeenCalledOnce();
});

it("displays error message when recovery error occurs", () => {
  renderResume(RESUMABLE, { error: "review_required" });

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.recovery.error.review_required"),
  );
});
