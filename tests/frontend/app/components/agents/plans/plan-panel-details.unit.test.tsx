import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanPanelDetails } from "@/app/components/agents/plans/plan-panel-details";

import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  recoveryState,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanPanelIssue } from "@/app/components/agents/plans/plan-panel-issues";

interface DetailsOptions {
  readonly page?: AgentPlanPage;
  readonly control?: AgentPlanControl;
  readonly issues?: readonly PlanPanelIssue[];
  readonly error?: string | null;
  readonly recoveryRunId?: string | null;
}

function renderDetails(
  options: DetailsOptions = {},
): ReturnType<typeof renderWithEditor> {
  const page = options.page ?? planPage();
  return renderWithEditor(page, actionScene(), (editor) => (
    <PlanPanelDetails
      id="details"
      page={page}
      editor={editor}
      control={options.control}
      issues={options.issues ?? []}
      error={options.error ?? null}
      recoveryRunId={options.recoveryRunId ?? null}
      recovery={recoveryState({ error: "plan_connection_unavailable" })}
    />
  ));
}

it("lists the findings and opens the plan choice, without a refusal or note", () => {
  renderDetails({
    issues: [{ key: "start", title: "Start", cause: "No outgoing flow." }],
  });

  expect(document.getElementById("details")).not.toBeNull();
  expect(screen.getByRole("listitem").textContent).toBe(
    "!StartNo outgoing flow.",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(i18n.t("plans.flow.storage.readOnly"))).toBeNull();
  expect(
    screen.getByRole("link", { name: i18n.t("plans.panel.manageWorkspaces") }),
  ).toBeDefined();
});

it("names the current nodes, target and next action for a workspace reservation", () => {
  renderDetails({
    control: planControl({
      canPlay: false,
      issue: "plan_workspace_conflict",
      workspaceConflict: {
        kind: "reserved",
        targets: [
          {
            kind: "remote",
            workspaceId: "workspace",
            path: "/synthetic/repository",
            connectionName: "Synthetic host",
            workspaceName: "Synthetic copy",
          },
        ],
        nodes: [{ id: "review", name: "Review" }],
      },
    }),
  });

  expect(screen.getByText(/Review/u)).toBeDefined();
  expect(
    screen.getByText(
      /Synthetic host · Synthetic copy · \/synthetic\/repository/u,
    ),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.panel.workspaceConflictRemedy.reserved")),
  ).toBeDefined();
});

it("names a refusal by its code, or generally for an unknown one", () => {
  const view = renderDetails({ error: "plan_workspace_missing" });
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("settings.agents.error.plan_workspace_missing", {
      defaultValue: i18n.t("plans.panel.error"),
    }),
  );
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.flow.storage.reload") }),
  ).toBeNull();
  view.unmount();

  renderDetails({ error: "synthetic_unknown_code" });

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.panel.error"),
  );
});

it("offers to reload the stored plan after a conflicting save", async () => {
  const { router } = renderDetails({ error: "plan_conflict" });
  const reload = screen.getByRole("button", {
    name: i18n.t("plans.flow.storage.reload"),
  });

  expect(screen.getByRole("alert").textContent).toContain(
    i18n.t("settings.agents.error.plan_conflict"),
  );
  fireEvent.click(reload);

  await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
  expect(router.state.location.pathname).toBe("/agents/plans");
  expect(router.state.location.search).toBe("?planId=plan");
});

it("says that a reader cannot change the plan", () => {
  const selected = planView({ canEdit: false });
  renderDetails({ page: planPage({ selected, plans: [selected] }) });

  expect(screen.getByText(i18n.t("plans.flow.storage.readOnly"))).toBeDefined();
});

it.each([
  ["pausing", "plans.panel.pausingHint"],
  ["paused", "plans.panel.pausedHint"],
  ["stopping", "plans.panel.stoppingHint"],
] as const)("explains a %s run", (status, key) => {
  renderDetails({ control: planControl({ status }) });

  expect(screen.getByText(i18n.t(key))).toBeDefined();
});

it("names the adopted revision of a continuation and the snapshot an active run keeps", () => {
  renderDetails({
    control: planControl({
      status: "running",
      runId: "run",
      planRevision: 2,
      continuationVersion: 4,
    }),
  });

  expect(
    screen.getByText(
      i18n.t("plans.panel.revision", { version: 4, revision: 2 }),
    ),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.execution.nextRunTitle")),
  ).toBeDefined();
});

it("shows why a recoverable run cannot be read", () => {
  renderDetails({ recoveryRunId: "run" });

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t([
      "plans.recovery.error.plan_connection_unavailable",
      "settings.agents.error.plan_connection_unavailable",
      "plans.panel.error",
    ]),
  );
});
