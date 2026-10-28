import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryResume } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume";

import { i18n, recoveryView, renderTranslated } from "../plan-panel-fixture";

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
  isPending = false,
): ReturnType<typeof vi.fn> {
  const onSubmit = vi.fn();
  renderTranslated(
    <PlanRecoveryResume
      view={view}
      isPending={isPending}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

function resumeButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.recovery.resumeAction"),
  });
}

function review(step: string): HTMLElement {
  return screen.getByRole("checkbox", {
    name: i18n.t("plans.recovery.review", { step }),
  });
}

it("names what is taken over and continues only with a chosen mode and every review", () => {
  const onSubmit = renderResume(RESUMABLE);
  const fresh = screen.getByRole("radio", {
    name: `${i18n.t("plans.recovery.mode.new_session")} – ${i18n.t("plans.recovery.modeHint.new_session")}`,
  });

  expect(
    screen.getByText(
      i18n.t("plans.recovery.resumeHint", {
        reused: "Reviewer, unnamed",
        count: 2,
      }),
    ),
  ).toBeDefined();
  expect(
    screen
      .getByRole("radio", {
        name: `${i18n.t("plans.recovery.mode.native_resume")} – ${i18n.t("plans.recovery.modeUnavailable")}`,
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(resumeButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(fresh);
  fireEvent.click(review("Writer"));
  expect(resumeButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(review("other"));
  fireEvent.click(review("Writer"));
  expect(resumeButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(review("Writer"));
  fireEvent.click(resumeButton());

  expect(onSubmit).toHaveBeenCalledWith({
    action: "resume",
    mode: "new_session",
    reviewedStepIds: ["other", "second"],
  });
});

it("keeps an unavailable resume and a pending decision closed", () => {
  renderResume(recoveryView());

  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByText(
      i18n.t("plans.recovery.resumeHint", { reused: "", count: 0 }),
    ),
  ).toBeDefined();
});

it("disables the decision while it is on its way", () => {
  renderResume(RESUMABLE, true);

  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  expect(resumeButton().hasAttribute("disabled")).toBe(true);
});
