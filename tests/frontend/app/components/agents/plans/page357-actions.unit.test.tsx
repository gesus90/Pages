import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRunActions } from "@/app/components/agents/plans/plan-run-actions";

import { i18n, planControl, renderTranslated } from "./plan-panel-fixture";

it("allows Stop on the first click even while Pause is pending", () => {
  const onAction = vi.fn();
  renderTranslated(
    <PlanRunActions
      control={planControl({
        status: "running",
        canPlay: false,
        canPause: true,
        canStop: true,
      })}
      isReadOnly={false}
      isPending={true}
      pendingIntent="pause-plan"
      isDirty={false}
      hasDeletedFrontier={false}
      onAction={onAction}
    />,
  );
  const stop = screen.getByRole("button", { name: i18n.t("plans.panel.stop") });
  expect(stop.hasAttribute("disabled")).toBe(false);
  fireEvent.click(stop);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("stop-plan");
});

it("disables Resume permanently after Stop and leaves Start enabled", () => {
  renderTranslated(
    <PlanRunActions
      control={planControl({
        status: "cancelled",
        canPlay: true,
        canResume: false,
        canStop: false,
        resumeKind: "stopped",
      })}
      isReadOnly={false}
      isPending={false}
      pendingIntent={null}
      isDirty={false}
      hasDeletedFrontier={false}
      onAction={vi.fn()}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.panel.resume") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.panel.play") })
      .hasAttribute("disabled"),
  ).toBe(false);
});
