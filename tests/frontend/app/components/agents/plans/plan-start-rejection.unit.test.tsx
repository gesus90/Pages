import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanStartRejection } from "@/app/components/agents/plans/plan-start-rejection";

import { i18n, renderTranslated } from "./plan-panel-fixture";

import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

const REJECTION: AgentPlanStartRejection = {
  id: "rejection",
  createdAt: "2026-10-28T12:00:00.000Z",
  action: "play",
  planRevision: 2,
  isSavedRevision: true,
  error: "plan_workspace_conflict",
  conflict: {
    kind: "reserved",
    targets: [
      {
        kind: "remote",
        workspaceId: "workspace",
        path: "/synthetic",
        connectionName: "Synthetic host",
        workspaceName: "Synthetic copy",
      },
    ],
    nodes: [{ id: "writer", name: "Writer" }],
  },
  reservation: "held",
  targetResolution: "remote_registered",
};

it("labels a past refusal separately and names the affected own target", () => {
  renderTranslated(<PlanStartRejection rejection={REJECTION} />);
  expect(
    screen.getByText(
      i18n.t("plans.panel.lastStartRejection", {
        time: new Date(REJECTION.createdAt).toLocaleString(),
        revision: 2,
      }),
    ),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionReservation.held")),
  ).toBeDefined();
  expect(
    screen.getByText(
      i18n.t("plans.panel.workspaceConflictNodes", { nodes: "Writer" }),
    ),
  ).toBeDefined();
  expect(
    screen.getByText(
      i18n.t("plans.panel.workspaceConflictTargets", {
        targets: "Synthetic host · Synthetic copy · /synthetic",
      }),
    ),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionRemoteIdentity")),
  ).toBeDefined();
});

it("does not invent unavailable target details and marks an unsaved draft", () => {
  renderTranslated(
    <PlanStartRejection
      rejection={{
        ...REJECTION,
        action: "save_and_play",
        isSavedRevision: false,
        conflict: null,
        reservation: "unknown",
        targetResolution: "unknown",
      }}
    />,
  );
  expect(screen.getByText(i18n.t("plans.panel.rejectedDraft"))).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionDetailsUnavailable")),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionReservation.unknown")),
  ).toBeDefined();
});

it("shows the specific past preparation error without inventing a workspace conflict", () => {
  renderTranslated(
    <PlanStartRejection
      rejection={{
        ...REJECTION,
        error: "plan_script_interpreter_unavailable",
        conflict: null,
        reservation: "not_requested",
        targetResolution: "unknown",
      }}
    />,
  );
  expect(
    screen.getByText(/plan_script_interpreter_unavailable/u),
  ).toBeDefined();
  expect(
    screen.queryByText(i18n.t("plans.panel.rejectionDetailsUnavailable")),
  ).toBeNull();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionReservation.not_requested")),
  ).toBeDefined();
});

it("shows the recorded node and port and marks filtered historical details", () => {
  renderTranslated(
    <PlanStartRejection
      rejection={{
        ...REJECTION,
        error: "plan_invalid",
        conflict: null,
        reservation: "not_requested",
        targetResolution: "unknown",
        issues: [{ nodeId: "review", port: "input", problem: "required" }],
        issueDetailsFiltered: true,
      }}
    />,
  );
  expect(screen.getByText(/review · input/u)).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.rejectionIssuesFiltered")),
  ).toBeDefined();
});
