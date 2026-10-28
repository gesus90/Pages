import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRecoveryRestart } from "@/app/components/agents/plans/plan-recovery/plan-recovery-restart";

import { i18n, recoveryView, renderTranslated } from "../plan-panel-fixture";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";

function renderRestart(
  view: AgentPlanRecoveryView,
  isPending = false,
): ReturnType<typeof vi.fn> {
  const onSubmit = vi.fn();
  renderTranslated(
    <PlanRecoveryRestart
      view={view}
      isPending={isPending}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

function restartButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.recovery.restartAction", { revision: 3 }),
  });
}

function confirmation(): HTMLElement {
  return screen.getByRole("checkbox", {
    name: i18n.t("plans.recovery.confirmRepeat"),
  });
}

it("starts the saved revision again only after the repeat was confirmed", () => {
  const onSubmit = renderRestart(
    recoveryView({ restart: { available: true, reason: null } }),
  );

  expect(
    screen.getByText(i18n.t("plans.recovery.restartHint", { revision: 3 })),
  ).toBeDefined();
  expect(restartButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(confirmation());
  fireEvent.click(restartButton());

  expect(onSubmit).toHaveBeenCalledWith({
    action: "restart",
    revision: 3,
    confirmRepeat: true,
  });
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.recovery.releaseAction"),
    }),
  ).toBeNull();
});

it("keeps an unavailable restart closed and releases what an unproven cleanup holds", () => {
  const onSubmit = renderRestart(
    recoveryView({ release: { available: true, reason: null } }),
  );

  expect(confirmation().hasAttribute("disabled")).toBe(true);
  expect(restartButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.recovery.releaseAction"),
    }),
  );

  expect(onSubmit).toHaveBeenCalledWith({ action: "release" });
});

it("disables every decision while one is on its way", () => {
  renderRestart(
    recoveryView({
      restart: { available: true, reason: null },
      release: { available: true, reason: null },
    }),
    true,
  );

  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  expect(restartButton().hasAttribute("disabled")).toBe(true);
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.recovery.releaseAction") })
      .hasAttribute("disabled"),
  ).toBe(true);
});
