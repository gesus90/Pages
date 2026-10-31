import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanNextRunNote,
  PlanPanelHeading,
} from "@/app/components/agents/plans/plan-panel-heading";

import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanEditor } from "./plan-panel-fixture";

interface HeadingOptions {
  readonly control?: AgentPlanControl;
  readonly isPending?: boolean;
  readonly isOpen?: boolean;
}

function renderHeading(
  page: AgentPlanPage,
  options: HeadingOptions = {},
): {
  readonly scene: ReturnType<typeof actionScene>;
  readonly onToggle: ReturnType<typeof vi.fn>;
  readonly unmount: () => void;
} {
  const scene = actionScene();
  const onToggle = vi.fn();
  function subject(editor: PlanEditor): React.ReactNode {
    return (
      <PlanPanelHeading
        page={page}
        editor={editor}
        control={options.control}
        isPending={options.isPending ?? false}
        pendingIntent={null}
        hasDeletedFrontier={false}
        recovery={null}
        isOpen={options.isOpen ?? false}
        detailsId="details"
        onToggle={onToggle}
        onAction={vi.fn()}
        onRecover={vi.fn()}
        onManage={vi.fn()}
      />
    );
  }
  const { unmount } = renderWithEditor(page, scene, subject);
  return { scene, onToggle, unmount };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("plans.execution.save") });
}

function contextLine(): string | null | undefined {
  return screen.getByRole("heading").nextElementSibling?.textContent;
}

function revisionLine(): string | null | undefined {
  return screen.getByText(/^Revision \d/u).textContent;
}

it("names the plan in its workspace and saves only an edited draft", async () => {
  const { scene } = renderHeading(planPage());

  expect(
    screen
      .getByRole("heading", { name: "Synthetic plan" })
      .getAttribute("title"),
  ).toBe("Synthetic plan");
  expect(screen.getByText("Project · Workspace")).toBeDefined();
  expect(revisionLine()).toBe(
    `Revision 3 · ${i18n.t("plans.panel.savedShort")}`,
  );
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  expect(revisionLine()).toBe(
    `Revision 3 · ${i18n.t("plans.panel.unsavedShort")}`,
  );
  fireEvent.click(saveButton());

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(scene.submissions[0].get("intent")).toBe("save-plan");
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows the save as running until the server has answered and only then as stored", async () => {
  let release = (): void => undefined;
  const { scene } = renderHeading(planPage());
  scene.answer = { ok: true, intent: "save-plan", revision: 4 };
  scene.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(saveButton());

  await waitFor(() =>
    expect(revisionLine()).toBe(
      `Revision 3 · ${i18n.t("plans.panel.savingShort")}`,
    ),
  );
  expect(saveButton().getAttribute("aria-busy")).toBe("true");
  act(() => release());

  await waitFor(() =>
    expect(revisionLine()).toBe(
      `Revision 4 · ${i18n.t("plans.panel.savedShort")}`,
    ),
  );
  expect(saveButton().getAttribute("aria-busy")).not.toBe("true");
});

it("keeps saving closed while a request is on its way or the person may not edit", () => {
  const view = renderHeading(planPage(), { isPending: true });
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  view.unmount();

  const readOnly = planView({ canEdit: false });
  renderHeading(planPage({ selected: readOnly, plans: [readOnly] }));
  fireEvent.click(screen.getAllByRole("button", { name: "Edit draft" })[0]);

  expect(
    screen
      .getAllByRole("button", { name: i18n.t("plans.execution.save") })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
});

it("names an untitled plan and a plan whose workspace is gone, which asks for another", () => {
  const selected = planView({
    name: "",
    workspaceId: "gone",
    isWorkspaceMissing: true,
  });
  renderHeading(planPage({ selected, plans: [selected] }));

  expect(
    screen.getByRole("heading", { name: i18n.t("plans.title") }),
  ).toBeDefined();
  expect(
    screen.getByText(`Project · ${i18n.t("plans.manage.withoutWorkspace")}`),
  ).toBeDefined();
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.manage.reassignWorkspace"),
  );
});

it("leaves the context empty and saving closed for a new plan without a workspace", () => {
  renderHeading(planPage({ selected: null }));
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));

  expect(saveButton().hasAttribute("disabled")).toBe(true);
  expect(revisionLine()).toBe(
    `Revision 0 · ${i18n.t("plans.panel.unsavedShort")}`,
  );
});

const REMOTE = {
  workspaceId: "remote",
  workspaceName: "Build box",
  connectionName: "nas",
  projectId: "project",
  path: "/srv/build",
  isUsable: true,
  reason: null,
};

it("names the remote host of a plan that runs elsewhere", () => {
  const selected = planView({
    executionTarget: { kind: "remote", workspaceId: "remote" },
  });
  renderHeading(
    planPage({ selected, plans: [selected], remoteWorkspaces: [REMOTE] }),
  );

  expect(contextLine()).toBe(
    i18n.t("plans.manage.remoteContext", {
      project: "Project",
      workspace: "Build box",
      host: "nas",
    }),
  );
});

it("says that a remote target the person no longer sees is unavailable", () => {
  const selected = planView({
    executionTarget: { kind: "remote", workspaceId: "remote" },
  });
  renderHeading(planPage({ selected, plans: [selected] }));

  expect(contextLine()).toBe(
    i18n.t("plans.manage.remoteContext", {
      project: "Project",
      workspace: i18n.t("plans.execution.unavailable"),
      host: "",
    }),
  );
});

it("names a remote target of a new plan before it has a known workspace", () => {
  const page = planPage({ selected: null, remoteWorkspaces: [REMOTE] });
  renderWithEditor(page, actionScene(), (editor) => (
    <>
      <button
        type="button"
        onClick={() =>
          editor.saveWith((draft) => ({
            ...draft,
            workspaceId: "unknown",
            executionTarget: { kind: "remote", workspaceId: "remote" },
          }))
        }
      >
        Target remote
      </button>
      <PlanPanelHeading
        page={page}
        editor={editor}
        control={undefined}
        isPending={false}
        pendingIntent={null}
        hasDeletedFrontier={false}
        recovery={null}
        isOpen={false}
        detailsId="details"
        onToggle={vi.fn()}
        onAction={vi.fn()}
        onRecover={vi.fn()}
        onManage={vi.fn()}
      />
    </>
  ));

  fireEvent.click(screen.getByRole("button", { name: "Target remote" }));

  expect(contextLine()).toBe(
    i18n.t("plans.manage.remoteContext", {
      project: "",
      workspace: "Build box",
      host: "nas",
    }),
  );
});

it("toggles the details with a labelled control", () => {
  const { onToggle } = renderHeading(planPage());
  const toggle = screen.getByRole("button", {
    name: i18n.t("plans.panel.expand"),
  });

  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.getAttribute("aria-controls")).toBe("details");
  fireEvent.click(toggle);

  expect(onToggle).toHaveBeenCalledOnce();
});

it("labels the open details as collapsible", () => {
  renderHeading(planPage(), { isOpen: true });

  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.panel.collapse") })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});

it("names the snapshot an active run keeps", () => {
  renderHeading(planPage(), {
    control: planControl({ status: "running", runId: "run", planRevision: 2 }),
  });

  expect(revisionLine()).toBe(
    `Revision 3 · ${i18n.t("plans.panel.savedShort")} · ${i18n.t("plans.execution.activeSnapshot", { revision: 2 })}`,
  );
});

it("names no snapshot for an ended run or one without an identifier", () => {
  const view = renderHeading(planPage(), {
    control: planControl({ status: "running", planRevision: 2 }),
  });
  expect(revisionLine()).toBe(
    `Revision 3 · ${i18n.t("plans.panel.savedShort")}`,
  );
  view.unmount();

  renderHeading(planPage(), {
    control: planControl({
      status: "succeeded",
      runId: "run",
      planRevision: 2,
    }),
  });

  expect(revisionLine()).toBe(
    `Revision 3 · ${i18n.t("plans.panel.savedShort")}`,
  );
});

function renderNote(control: AgentPlanControl | undefined): void {
  renderWithEditor(planPage(), actionScene(), (editor) => (
    <PlanNextRunNote editor={editor} control={control} />
  ));
}

it("says that a saved revision waits for the next run", () => {
  renderNote(planControl({ status: "running", runId: "run", planRevision: 2 }));

  expect(
    screen.getByText(i18n.t("plans.execution.nextRunTitle")),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.execution.nextRunHint", { revision: 2 })),
  ).toBeDefined();
});

it.each([
  ["no control", undefined],
  ["an idle plan", planControl({ runId: "run", planRevision: 2 })],
  [
    "a run without identifier",
    planControl({ status: "running", planRevision: 2 }),
  ],
  [
    "a run of the saved revision",
    planControl({ status: "running", runId: "run", planRevision: 3 }),
  ],
])("says nothing about the next run for %s", (name, control) => {
  renderNote(control);

  expect(screen.queryByText(i18n.t("plans.execution.nextRunTitle"))).toBeNull();
});
