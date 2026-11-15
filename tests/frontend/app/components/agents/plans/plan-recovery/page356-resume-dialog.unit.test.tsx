import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanFailedResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-failed-resume-dialog";
import { PlanRunActions } from "@/app/components/agents/plans/plan-run-actions";
import { RunStepsTab } from "@/app/components/agents/runs/run-steps-tab";

import {
  i18n,
  planControl,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "../plan-panel-fixture";

it("names inherited steps and uses the current saved revision when continuing", async () => {
  const submit = vi.fn(async () => ({
    commandId: "resume",
    revision: 8,
    outcome: "started" as const,
    runId: "continued",
  }));
  const onClose = vi.fn();
  renderTranslated(
    <PlanFailedResumeDialog
      onClose={onClose}
      recovery={recoveryState({
        submit,
        view: recoveryView({
          resume: {
            available: true,
            reason: null,
            modes: [],
            reusedStepIds: ["first"],
            reviewStepIds: ["second"],
          },
        }),
      })}
    />,
  );
  expect(screen.getByText("Reviewer")).toBeTruthy();
  expect(
    screen.getByText(i18n.t("plans.recovery.completedChangesIgnored")),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.panel.resume") }),
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: "resume",
      revision: 3,
      confirmContinue: true,
    }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("disables Continue after Stop and permits Start", () => {
  const onAction = vi.fn();
  renderTranslated(
    <PlanRunActions
      control={planControl({
        status: "cancelled",
        runId: "stopped",
        resumeKind: "stopped",
        canResume: false,
        canPlay: true,
      })}
      isReadOnly={false}
      isPending={false}
      pendingIntent={null}
      isDirty={false}
      hasDeletedFrontier={false}
      onAction={onAction}
    />,
  );
  const resume = screen.getByRole("button", {
    name: i18n.t("plans.panel.resume"),
  });
  expect(resume.hasAttribute("disabled")).toBe(true);
  fireEvent.click(resume);
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.panel.play") }),
  );
  expect(onAction).toHaveBeenCalledWith("play-plan");
});

it("labels a taken-over successful result as inherited in run history", () => {
  renderTranslated(
    <RunStepsTab
      steps={[
        {
          stepId: "prepare",
          name: "Prepare",
          status: "succeeded",
          isInherited: true,
          isBlocked: false,
          error: null,
          verdict: null,
          startedAt: null,
          endedAt: null,
          hasReport: true,
        },
      ]}
    />,
  );
  expect(screen.getByText(i18n.t("plans.recovery.inherited"))).toBeTruthy();
});
