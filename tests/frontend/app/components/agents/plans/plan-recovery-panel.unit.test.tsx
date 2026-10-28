import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanRecoveryPanel,
  recoverableRunId,
} from "@/app/components/agents/plans/plan-recovery-panel";

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

it("offers recovery only for the newest run that failed, was stopped or is stopping", () => {
  expect(recoverableRunId(undefined)).toBeNull();
  expect(recoverableRunId(planControl({ status: "failed" }))).toBeNull();
  expect(
    recoverableRunId(planControl({ status: "running", runId: "run" })),
  ).toBeNull();
  for (const status of ["failed", "cancelled", "stopping"] as const)
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

it("shows the state, every blocker, the restart, its result and a refusal", () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => null);
  renderPanel(
    "run",
    recoveryState({
      view: recoveryView({
        blockers: ["superseded", "cleanup_unconfirmed"],
        release: { available: true, reason: null },
      }),
      isPending: false,
      result: { commandId: "c", revision: 8, outcome: "released" },
      error: "synthetic_unknown",
      submit,
    }),
  );
  const section = screen.getByRole("region", {
    name: i18n.t("plans.recovery.title"),
  });

  expect(section.getAttribute("aria-busy")).toBe("false");
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    i18n.t("plans.recovery.blocker.superseded"),
    i18n.t("plans.recovery.blocker.cleanup_unconfirmed"),
  ]);
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.recovery.result.released"),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.panel.error"),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.recovery.releaseAction"),
    }),
  );

  expect(submit).toHaveBeenCalledWith({ action: "release" });
});

it("marks a pending decision and lists no blockers when there are none", () => {
  renderPanel("run", recoveryState({ view: recoveryView(), isPending: true }));

  expect(
    screen
      .getByRole("region", { name: i18n.t("plans.recovery.title") })
      .getAttribute("aria-busy"),
  ).toBe("true");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
