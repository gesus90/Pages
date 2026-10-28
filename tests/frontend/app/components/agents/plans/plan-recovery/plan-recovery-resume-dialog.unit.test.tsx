import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume-dialog";

import {
  i18n,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "../plan-panel-fixture";

import type { PlanRecovery } from "../plan-panel-fixture";

const VIEW = recoveryView({
  resume: {
    available: true,
    reason: null,
    modes: [{ mode: "new_session", available: true }],
    reusedStepIds: [],
    reviewStepIds: [],
  },
});

function renderDialog(recovery: PlanRecovery): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  renderTranslated(
    <PlanRecoveryResumeDialog recovery={recovery} onClose={onClose} />,
  );
  return onClose;
}

function continueRun(): void {
  fireEvent.click(
    screen.getByRole("radio", {
      name: new RegExp(i18n.t("plans.recovery.mode.new_session")),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.recovery.resumeAction") }),
  );
}

it("shows nothing before the recovery view is known", () => {
  renderDialog(recoveryState());

  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes once the decision started a new run", async () => {
  const submit = vi.fn(async () => ({
    commandId: "command",
    revision: 8,
    outcome: "started" as const,
    runId: "run-2",
  }));
  const onClose = renderDialog(recoveryState({ view: VIEW, submit }));

  expect(
    screen.getByRole("dialog", { name: i18n.t("plans.recovery.resumeTitle") }),
  ).toBeDefined();
  continueRun();

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(submit).toHaveBeenCalledWith({
    action: "resume",
    mode: "new_session",
    reviewedStepIds: [],
  });
});

it("stays open when the decision was refused or started nothing", async () => {
  const submit = vi
    .fn<PlanRecovery["submit"]>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      commandId: "c",
      revision: 8,
      outcome: "recorded",
    });
  const onClose = renderDialog(recoveryState({ view: VIEW, submit }));

  continueRun();
  continueRun();

  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(onClose).not.toHaveBeenCalled();
});

it("names a refusal and closes with Cancel or Escape", () => {
  const onClose = renderDialog(
    recoveryState({ view: VIEW, error: "review_required" }),
  );

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.recovery.error.review_required"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(onClose).toHaveBeenCalledTimes(2);
});

it("cannot be closed while the decision is on its way", () => {
  const onClose = renderDialog(recoveryState({ view: VIEW, isPending: true }));

  expect(
    screen
      .getByRole("button", { name: i18n.t("settings.agents.cancel") })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});
