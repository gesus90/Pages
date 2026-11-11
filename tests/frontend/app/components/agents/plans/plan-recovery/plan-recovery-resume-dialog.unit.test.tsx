import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume-dialog";

import { recoveryState, renderTranslated } from "../plan-panel-fixture";

import type { PlanRecovery } from "../plan-panel-fixture";

function renderDialog(recovery: PlanRecovery): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  renderTranslated(
    <PlanRecoveryResumeDialog recovery={recovery} onClose={onClose} />,
  );
  return onClose;
}

it("shows nothing before the recovery view is known", () => {
  renderDialog(recoveryState());

  expect(screen.queryByRole("dialog")).toBeNull();
});
