import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanRecoveryState } from "@/app/components/agents/plans/plan-recovery/plan-recovery-state";

import { i18n, recoveryView, renderTranslated } from "../plan-panel-fixture";

import type { AgentPlanCheckpoint } from "@/definition/AgentPlanRecovery";

const COMPLETED_AT = "2026-10-15T10:00:00.000Z";

function checkpoint(stepId: string): AgentPlanCheckpoint {
  return {
    schemaVersion: 1,
    version: 5,
    runRevision: 4,
    runId: "run-1",
    planId: "plan",
    planRevision: 2,
    stepId,
    completedAt: COMPLETED_AT,
    snapshotDigest: "digest",
    workflow: { engine: "pages", runId: null },
    completedStepIds: [stepId],
    pendingStepIds: [],
    dependencies: [],
    inputs: [],
    configurationDigest: "digest",
    workspaceDigest: "digest",
    context: {
      groupId: null,
      agentId: null,
      agentRevision: null,
      connectionId: null,
      provider: null,
      model: null,
      workspaceIds: [],
    },
    dispatchedPromptDigest: null,
    result: {
      output: null,
      isOutputReduced: false,
      outputDigest: "digest",
      technical: { resultCode: 0, closeout: null },
      acceptance: null,
    },
    session: null,
  };
}

function value(label: string): string | null | undefined {
  return screen.getByText(i18n.t(label)).nextElementSibling?.textContent;
}

it("names the state, no failure point, no checkpoint and both revisions", () => {
  renderTranslated(<PlanRecoveryState view={recoveryView()} />);

  expect(value("plans.recovery.stateLabel")).toBe(
    i18n.t("plans.recovery.state.recoverable"),
  );
  expect(value("plans.recovery.failedAt")).toBe(
    i18n.t("plans.recovery.noFailure"),
  );
  expect(value("plans.recovery.checkpoint")).toBe(
    i18n.t("plans.recovery.checkpointNone"),
  );
  expect(value("plans.recovery.revisions")).toBe(
    i18n.t("plans.recovery.revisionValue", { run: 2, current: 3 }),
  );
  expect(screen.queryByText(i18n.t("plans.recovery.originLabel"))).toBeNull();
});

it("names failed nodes by name with their reason and the last verified checkpoint", () => {
  const node = {
    failureClass: "provider",
    canRecordRepair: false,
    sideEffects: "unknown",
    capabilities: null,
    modes: [],
  } as const;
  renderTranslated(
    <PlanRecoveryState
      view={recoveryView({
        nodes: [
          { ...node, stepId: "first", error: "plan_step_failed" },
          { ...node, stepId: "unnamed", error: "synthetic_unknown" },
          { ...node, stepId: "second", error: null },
        ],
        checkpoint: checkpoint("first"),
      })}
    />,
  );

  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    `Reviewer: ${i18n.t("settings.agents.error.plan_step_failed")}`,
    "unnamed: synthetic_unknown",
    "Writer",
  ]);
  expect(value("plans.recovery.checkpoint")).toBe(
    i18n.t("plans.recovery.checkpointValue", {
      version: 5,
      step: "Reviewer",
      time: new Date(COMPLETED_AT).toLocaleString(),
    }),
  );
});

it("names the run a restart or resume came from", () => {
  const origin = {
    runId: "0123456789abcdef",
    checkpointVersion: null,
    reusedStepIds: ["first"],
    retriedStepIds: ["second", "third"],
    reviewedStepIds: [],
    requestedAt: COMPLETED_AT,
  };
  const view = renderTranslated(
    <PlanRecoveryState
      view={recoveryView({
        origin: { ...origin, kind: "restart", mode: null },
      })}
    />,
  );
  expect(value("plans.recovery.originLabel")).toBe(
    i18n.t("plans.recovery.origin.restart", {
      run: "01234567",
      mode: "",
      reused: 1,
      retried: 2,
    }),
  );
  view.unmount();

  renderTranslated(
    <PlanRecoveryState
      view={recoveryView({
        origin: { ...origin, kind: "resume", mode: "new_session" },
      })}
    />,
  );

  expect(value("plans.recovery.originLabel")).toBe(
    i18n.t("plans.recovery.origin.resume", {
      run: "01234567",
      mode: i18n.t("plans.recovery.mode.new_session"),
      reused: 1,
      retried: 2,
    }),
  );
});
