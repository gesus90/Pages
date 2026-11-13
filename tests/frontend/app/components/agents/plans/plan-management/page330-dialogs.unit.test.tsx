import { ReactFlowProvider } from "@xyflow/react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanAgentCard } from "@/app/components/agents/plans/plan-node-card/plan-agent-card";
import { PlanCloneDialog } from "@/app/components/agents/plans/plan-management/plan-clone-dialog";
import { PlanEditDialog } from "@/app/components/agents/plans/plan-management/plan-edit-dialog";
import { PlanTeamRows } from "@/app/components/agents/plans/plan-management/plan-access-teams";
import { PlanSelectionNotice } from "@/app/components/agents/plans/plan-selection-notice";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";
import { planPendingSelections } from "@/definition/AgentPlanSelection";

import { renderTranslated, flowContext } from "../plan-group-fixture";
import { actionScene, renderWithEditor } from "../plan-panel-fixture";
import { agentStep } from "../plan-flow-fixture";
import {
  managementPage,
  managementState,
  planView,
} from "./plan-management-fixture";

it("shows only name and collapsed options; a foreign workspace, empty or taken name never disables cloning", () => {
  const source = planView({ workspaceId: "foreign" });
  const page = managementPage();
  const management = managementState();
  const { baseElement: container } = renderTranslated(
    <PlanCloneDialog
      page={page}
      source={source}
      isDirty={false}
      isOneShot={false}
      management={management}
    />,
  );
  expect(container.querySelector("details")?.open).toBe(false);
  const name = screen.getByLabelText("Name");
  expect(name).toHaveProperty("value", "Kopie von Review plan");
  expect(screen.getByRole("button", { name: "Klonen" })).toHaveProperty(
    "disabled",
    false,
  );
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Klonen" }));
  expect(management.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      intent: "clone-plan",
      name: "",
      planId: source.id,
    }),
    expect.any(String),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  const request = vi.mocked(management.submit).mock.calls[0]?.[0];
  expect(request).not.toHaveProperty("workspaceId");
  fireEvent.change(name, { target: { value: "Review plan" } });
  expect(screen.getByRole("button", { name: "Klonen" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps cloning enabled during a pending request and shows an actionable server reason", () => {
  const { rerender } = renderTranslated(
    <PlanCloneDialog
      page={managementPage()}
      source={planView()}
      isDirty={false}
      isOneShot={false}
      management={managementState({ isPending: true })}
    />,
  );
  expect(screen.getByRole("button", { name: "Klonen" })).toHaveProperty(
    "disabled",
    false,
  );
  rerender(
    <PlanCloneDialog
      page={managementPage()}
      source={planView()}
      isDirty={false}
      isOneShot={false}
      management={managementState({ error: "source_not_visible" })}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Lade die Planliste neu",
  );
});

it("uses the server's create team default and sends people as read-only team entries", () => {
  const page = managementPage({
    directory: {
      persons: [{ id: "Mei", name: "Mei" }],
      departments: [{ id: "team", name: "Entwicklung" }],
      groups: [],
    },
  });
  const management = managementState();
  const { baseElement: container } = renderTranslated(
    <PlanCloneDialog
      page={page}
      source={planView()}
      isDirty={false}
      isOneShot={false}
      management={management}
    />,
  );
  const disclosure = container.querySelector("details");
  if (!disclosure) throw new Error("missing options");
  fireEvent.click(within(disclosure).getByText("Weitere Optionen"));
  fireEvent.click(screen.getByRole("button", { name: /Mei/ }));
  const row = container.querySelector('[data-plan-team="Mei"]');
  expect(row?.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(screen.getByText("Personen können nur lesen.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Klonen" }));
  const request = vi.mocked(management.submit).mock.calls[0]?.[0];
  expect(JSON.parse(request?.teams ?? "null")).toEqual([
    fullPlanTeam("department", "team"),
    fullPlanTeam("user", "Mei"),
  ]);
});

it("explains a read-only edit and offers Close and Clone with read-only fields", () => {
  const plan = planView({ canEdit: false });
  const page = managementPage({
    selected: plan,
    directory: {
      persons: [{ id: plan.ownerId, name: "Ed" }],
      groups: [],
      departments: [],
    },
  });
  const management = managementState();
  renderWithEditor(page, actionScene(), (editor) => (
    <PlanEditDialog
      page={page}
      plan={plan}
      editor={editor}
      management={management}
    />
  ));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("Read only.")).toBeDefined();
  expect(dialog.getByText(/The plan belongs to Ed/)).toBeDefined();
  expect(dialog.getByLabelText("Name")).toHaveProperty("readOnly", true);
  expect(dialog.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Clone" }));
  expect(management.open).toHaveBeenCalledWith("clone");
});

it("shows tool-set teams in Edit and submits the changed canonical list with the graph", async () => {
  const plan = planView({
    teams: [fullPlanTeam("user", "Mei")],
    rights: {
      canRead: true,
      canEdit: true,
      canRun: true,
      canManageTeams: true,
      canChangeOwner: false,
      canDelete: true,
      isAdministrator: false,
      isAdminAccess: false,
    },
  });
  const page = managementPage({
    selected: plan,
    directory: {
      persons: [{ id: "Mei", name: "Mei" }],
      groups: [],
      departments: [],
    },
  });
  const scene = actionScene();
  const { baseElement: container } = renderWithEditor(page, scene, (editor) => (
    <PlanEditDialog
      page={page}
      plan={plan}
      editor={editor}
      management={managementState()}
    />
  ));
  const details = container.querySelector("details");
  if (!details) throw new Error("missing options");
  expect(details.open).toBe(false);
  fireEvent.click(within(details).getByText("More options"));
  expect(container.querySelector('[data-plan-team="Mei"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Remove Mei/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(JSON.parse(String(scene.submissions[0]?.get("access")))).toEqual({
    teams: [],
  });
});

it("omits edit and run controls for people in the shared access rows", () => {
  const { baseElement: container } = renderTranslated(
    <PlanTeamRows
      directory={{
        persons: [{ id: "Mei", name: "Mei" }],
        groups: [],
        departments: [],
      }}
      teams={[fullPlanTeam("user", "Mei")]}
      isDisabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(
    container.querySelector('[data-plan-team-right="canRead"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('[data-plan-team-right="canEdit"]'),
  ).toBeNull();
  expect(container.querySelector('[data-plan-team-right="canRun"]')).toBeNull();
});

it("names pending choices and opens the first repaired node directly", () => {
  const step = { ...agentStep("first"), selectionRequired: "agent" as const };
  const draft = {
    ...planView(),
    nodes: [
      step,
      { ...agentStep("second"), selectionRequired: "model" as const },
    ],
  };
  const onEdit = vi.fn();
  const canvas = flowContext(draft, { onEdit });
  renderTranslated(<PlanSelectionNotice canvas={canvas} />);
  expect(screen.getByRole("status").textContent).toContain("2 Schritte");
  fireEvent.click(screen.getByRole("button", { name: "Zum ersten →" }));
  expect(canvas.graph.select).toHaveBeenCalledWith("first");
  expect(onEdit).toHaveBeenCalledWith("first");
  expect(planPendingSelections(draft)).toHaveLength(2);
});

it.each(["agent", "model"] as const)(
  "marks an open %s choice with text and a primary border",
  (selectionRequired) => {
    const step = { ...agentStep("pending"), selectionRequired };
    const base = flowContext({ ...planView(), nodes: [step] });
    const context = {
      ...base,
      graph: {
        ...base.graph,
        issues: [{ nodeId: step.id, port: null, reason: "agent" as const }],
      },
    };
    renderTranslated(
      <ReactFlowProvider>
        <PlanFlowContext.Provider value={context}>
          <PlanAgentCard step={step} result={undefined} hasRun={false} />
        </PlanFlowContext.Provider>
      </ReactFlowProvider>,
    );
    expect(screen.getByRole("article").classList.contains("border-2")).toBe(
      true,
    );
    expect(
      screen.getByRole("article").classList.contains("border-primary"),
    ).toBe(true);
    expect(
      screen.getByText(
        selectionRequired === "agent" ? "Agent wählen" : "Modell wählen",
      ),
    ).toBeDefined();
  },
);
