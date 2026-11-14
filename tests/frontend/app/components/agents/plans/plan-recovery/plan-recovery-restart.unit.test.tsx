import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume-dialog";

import {
  i18n,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "../plan-panel-fixture";

import type { PlanRecovery } from "../plan-panel-fixture";

function renderDialog(recovery: PlanRecovery): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  renderTranslated(
    <PlanRecoveryResumeDialog
      recovery={recovery}
      planName="Example"
      onClose={onClose}
    />,
  );
  return onClose;
}

it("confirms with exactly two buttons and sends the reviewed steps immediately", async () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => ({
    outcome: "started",
    commandId: "command",
    revision: 4,
    runId: "new",
  }));
  const onClose = renderDialog(
    recoveryState({
      view: recoveryView({
        runId: "12345678-abcd",
        restart: { available: true, reason: null, reviewStepIds: ["script"] },
      }),
      submit,
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("button")).toHaveLength(2);
  expect(dialog.querySelectorAll("input")).toHaveLength(0);
  expect(dialog.textContent).toContain("Example");
  expect(dialog.textContent).toContain("12345678");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.recovery.restartDialogAction"),
    }),
  );
  expect(submit).toHaveBeenCalledWith({
    action: "restart",
    revision: 3,
    confirmRepeat: true,
    reviewedStepIds: ["script"],
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("disables both buttons and displays the pending label while starting", () => {
  renderDialog(recoveryState({ view: recoveryView(), isPending: true }));
  const buttons = within(screen.getByRole("dialog")).getAllByRole("button");
  expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
  expect(
    screen
      .getByRole("button", {
        name: i18n.t("plans.recovery.restartDialogPending"),
      })
      .querySelector("svg"),
  ).not.toBeNull();
});

it("shows one refusal with reason and code and allows a retry", () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => null);
  renderDialog(
    recoveryState({
      view: recoveryView(),
      error: "cleanup_unconfirmed",
      submit,
    }),
  );
  const alerts = within(screen.getByRole("dialog")).getAllByRole("alert");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toContain(
    i18n.t("plans.recovery.error.cleanup_unconfirmed"),
  );
  expect(alerts[0]?.textContent).toContain("cleanup_unconfirmed");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.recovery.restartDialogRetry"),
    }),
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", { name: i18n.t("settings.agents.cancel") })
      .hasAttribute("disabled"),
  ).toBe(false);
});
