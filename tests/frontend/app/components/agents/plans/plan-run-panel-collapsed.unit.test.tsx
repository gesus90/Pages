import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanRunPanel } from "@/app/components/agents/plans/plan-run-panel";

import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  recoveryState,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { PlanEditor, PlanRecovery } from "./plan-panel-fixture";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanWriterWait } from "@/definition/AgentPlanExecution";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

const recoveryHook: { state: unknown } = vi.hoisted(() => ({
  state: undefined,
}));
vi.mock("@/app/components/agents/plans/use-plan-recovery", () => ({
  usePlanRecovery: () => recoveryHook.state,
}));
const FAILED = planControl({ runId: "run-1", status: "failed", canPlay: true });
function recovery(overrides: Partial<PlanRecovery> = {}): void {
  recoveryHook.state = recoveryState(overrides);
}
beforeEach(() => recovery());
function renderPanel(
  options: { control?: AgentPlanControl; page?: AgentPlanPage } = {},
): void {
  const page = options.page ?? planPage();
  renderWithEditor(page, actionScene(), (editor: PlanEditor) => (
    <PlanRunPanel
      page={page}
      editor={editor}
      control={options.control ?? planControl()}
      run={null}
      error={null}
      onRunStarted={vi.fn()}
      onRecoveryDecided={vi.fn()}
    />
  ));
}

const WAIT: AgentPlanWriterWait = {
  resource: "workspace",
  reason: "runner_offline",
  runId: "other",
  jobId: null,
  attemptId: null,
};

const CLEANUP: AgentWorkspaceCleanup = {
  workspaceId: "workspace",
  workspaceName: "Workspace",
  runId: "old",
  ownerId: "owner",
  blocker: "runner_offline",
  updatedAt: "2026-11-13T10:00:00.000Z",
};

const MISSING = planView({ workspaceId: "gone", isWorkspaceMissing: true });

/** An ended run with every note the panel knows at once. */
const NOISY = planControl({
  ...FAILED,
  resumeKind: "failed",
  workspaceWait: WAIT,
  cleanup: [CLEANUP],
  resumeBlock: { code: "cleanup_unconfirmed", action: "release" },
});

function statusMarker(): HTMLElement {
  const marker = document.querySelector<HTMLElement>(
    "[data-plan-panel-status]",
  );
  if (!marker) throw new Error("The status marker is missing.");
  return marker;
}

function attentionDot(): Element | null {
  return statusMarker().querySelector("[data-plan-panel-attention]");
}

const ATTENTION = i18n.t("plans.panel.attention");

it("shows only the heading and the status marker while collapsed", () => {
  recovery({ error: "plan_conflict" });
  renderPanel({
    page: planPage({ selected: MISSING, plans: [MISSING] }),
    control: NOISY,
  });

  const notes = screen.getAllByRole("status");
  expect(notes).toEqual([statusMarker().parentElement]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(statusMarker().textContent).toBe(
    `${i18n.t("plans.panel.state.failed.label")}, ${ATTENTION}`,
  );
  expect(statusMarker().getAttribute("aria-expanded")).toBe("false");
  expect(statusMarker().getAttribute("aria-controls")).toBeTruthy();
  for (const key of [
    "plans.panel.savedShort",
    "plans.manage.reassignWorkspace",
    "plans.panel.error",
  ])
    expect(screen.queryByText(i18n.t(key), { exact: false })).toBeNull();
  expect(
    screen.queryByText(i18n.t("plans.resumeBlock.reason.cleanup_unconfirmed"), {
      exact: false,
    }),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "Synthetic plan" })).toBeDefined();
});

it("leaves no hint beside the marker of a collapsed running run", () => {
  renderPanel({
    control: planControl({ runId: "run-9", status: "running", canPlay: false }),
  });

  expect(statusMarker().textContent).toBe(
    i18n.t("plans.panel.state.running.label"),
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.queryByText(i18n.t("plans.execution.editLocked"))).toBeNull();
  expect(attentionDot()).toBeNull();
});

it("shows every line of the open panel in the order of before", () => {
  recovery({ error: "plan_conflict" });
  renderPanel({
    page: planPage({ selected: MISSING, plans: [MISSING] }),
    control: NOISY,
  });

  fireEvent.click(statusMarker());

  const lines = [
    screen.getByText(i18n.t("plans.panel.savedShort")),
    screen.getByText(i18n.t("plans.resumeBlock.reason.cleanup_unconfirmed"), {
      exact: false,
    }),
    screen.getByText(
      i18n.t("plans.recovery.writerWait", {
        resource: "workspace",
        run: "other",
      }),
      { exact: false },
    ),
    screen.getByText(
      i18n.t("plans.recovery.cleanupObligation", {
        workspace: "Workspace",
        run: "old",
      }),
      { exact: false },
    ),
    screen.getByText(i18n.t("plans.manage.reassignWorkspace")),
    screen.getByRole("alert"),
    statusMarker(),
    document.getElementById(statusMarker().getAttribute("aria-controls") ?? ""),
  ];
  for (const [index, line] of lines.entries()) {
    expect(line, `line ${index}`).not.toBeNull();
    const next = lines[index + 1];
    if (line && next)
      expect(
        line.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
        `line ${index} before line ${index + 1}`,
      ).toBeTruthy();
  }
  expect(statusMarker().textContent).toBe(
    `${i18n.t("plans.panel.state.failed.label")}${i18n.t("plans.panel.state.failed.hint")}`,
  );
  expect(attentionDot()).toBeNull();
  expect(statusMarker().getAttribute("aria-expanded")).toBe("true");
});

it.each([
  ["waiting for the workspace", { workspaceWait: WAIT }],
  ["an open cleanup obligation", { cleanup: [CLEANUP] }],
] as const)(
  "marks the collapsed status with a warning dot for %s",
  (name, overrides) => {
    renderPanel({
      control: planControl({
        runId: "run-9",
        status: "running",
        canPlay: false,
        ...overrides,
      }),
    });

    expect(attentionDot()?.getAttribute("data-plan-panel-attention")).toBe(
      "warning",
    );
    expect(attentionDot()?.className, name).toContain("bg-warning");
    expect(attentionDot()?.className).toContain("ring-surface");
    expect(
      screen.getByRole("button", {
        name: `${i18n.t("plans.panel.state.running.label")}, ${ATTENTION}`,
      }),
    ).toBe(statusMarker());
  },
);

it("marks the collapsed status with a warning dot for a missing workspace", () => {
  renderPanel({ page: planPage({ selected: MISSING, plans: [MISSING] }) });

  expect(attentionDot()?.getAttribute("data-plan-panel-attention")).toBe(
    "warning",
  );
  expect(statusMarker().textContent).toContain(ATTENTION);
});

it("marks the collapsed status with an error dot for a refused recovery request", () => {
  recovery({ error: "plan_conflict" });
  renderPanel({ control: FAILED });

  expect(attentionDot()?.getAttribute("data-plan-panel-attention")).toBe(
    "error",
  );
  expect(attentionDot()?.className).toContain("bg-destructive");
  expect(
    screen.getByRole("button", {
      name: `${i18n.t("plans.panel.state.failed.label")}, ${ATTENTION}`,
    }),
  ).toBe(statusMarker());
});

it("shows no dot without a warning or an error", () => {
  renderPanel({ control: FAILED });

  expect(attentionDot()).toBeNull();
  expect(statusMarker().textContent).toBe(
    i18n.t("plans.panel.state.failed.label"),
  );
});

it("opens the plan menu and its dialog while collapsed", () => {
  renderPanel();

  fireEvent.pointerDown(
    screen.getByRole("button", { name: i18n.t("plans.manage.menu") }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: new RegExp(i18n.t("plans.manage.edit"), "u"),
    }),
  );

  expect(screen.getByRole("dialog")).toBeDefined();
  expect(statusMarker().getAttribute("aria-expanded")).toBe("false");
});

it("keeps the same focused marker while it opens and closes the panel", () => {
  renderPanel();
  const marker = statusMarker();
  marker.focus();

  fireEvent.click(marker);
  expect(statusMarker()).toBe(marker);
  expect(document.activeElement).toBe(marker);
  expect(marker.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(marker);
  expect(document.activeElement).toBe(marker);
  expect(marker.getAttribute("aria-expanded")).toBe("false");
});
