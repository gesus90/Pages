import { fireEvent, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanGroupFrame } from "@/app/components/agents/plans/plan-group-frame";

import {
  GROUP_SOURCES,
  agentNode,
  flowContext,
  graphStub,
  i18n,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type { PlanGroupSessionView } from "@/app/components/agents/plans/plan-group-session";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const NO_SESSION: PlanGroupSessionView = {
  state: "not_created",
  acpSessionId: null,
  creator: null,
  adapter: null,
  turns: 0,
};

const TEAM = sessionGroup({
  name: "Team",
  steps: [agentNode("m1", "codex"), agentNode("m2", "codex")],
});

interface FrameOptions {
  readonly group?: AgentPlanGroup;
  readonly graph?: PlanGraphActions;
  readonly canEdit?: boolean;
  readonly isCollapsed?: boolean;
  readonly isDropTarget?: boolean;
  readonly runError?: string | null;
  readonly onEdit?: (id: string) => void;
}

interface FrameSpies {
  readonly onToggle: ReturnType<typeof vi.fn>;
  readonly onSaveTemplate: ReturnType<typeof vi.fn>;
  readonly outerClick: ReturnType<typeof vi.fn>;
}

function renderFrame(options: FrameOptions = {}): FrameSpies {
  const group = options.group ?? TEAM;
  const graph = options.graph ?? graphStub();
  const spies = {
    onToggle: vi.fn(),
    onSaveTemplate: vi.fn(),
    outerClick: vi.fn(),
  };
  renderTranslated(
    <ReactFlowProvider>
      <PlanFlowContext value={flowContext(planOf([group]), { graph })}>
        <div onClick={spies.outerClick}>
          <PlanGroupFrame
            group={group}
            sources={GROUP_SOURCES}
            graph={graph}
            canEdit={options.canEdit ?? true}
            isDropTarget={options.isDropTarget ?? false}
            session={{ ...NO_SESSION, acpSessionId: "acp-7", state: "active" }}
            run={null}
            runError={options.runError}
            isCollapsed={options.isCollapsed ?? false}
            onToggle={spies.onToggle}
            onEdit={options.onEdit}
            onSaveTemplate={spies.onSaveTemplate}
          />
        </div>
      </PlanFlowContext>
    </ReactFlowProvider>,
  );
  return spies;
}

function frame(name = "Team"): HTMLElement {
  return screen.getByRole("region", {
    name: i18n.t("plans.groups.frame", { name }),
  });
}

it("shows an expanded group with its class, status, count, session and actions", () => {
  renderFrame();
  const region = frame();
  expect(region.dataset.planGroup).toBe("group");
  expect(region.dataset.collapsed).toBe("false");
  expect(region.className).toContain("rounded-[1.25rem]");
  expect(region.className).not.toContain("ring-2");
  expect(
    within(region).getByText(i18n.t("plans.groups.adapter.codex_cli")),
  ).toBeTruthy();
  expect(
    within(region).getByText(i18n.t("plans.groups.state.ready")),
  ).toBeTruthy();
  expect(
    within(region).getByRole("img", {
      name: i18n.t("plans.progress.count", { completed: 0, total: 2 }),
    }),
  ).toBeTruthy();
  expect(region.textContent).toContain("acp-7");
  expect(
    within(region).getByRole("button", {
      name: i18n.t("plans.groups.collapse"),
    }),
  ).toHaveProperty("ariaExpanded", "true");
  expect(screen.queryByText(i18n.t("plans.groups.needsRepair"))).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("selects, edits, deletes and saves the group from its header", async () => {
  const graph = graphStub();
  const onEdit = vi.fn();
  const spies = renderFrame({ graph, onEdit });
  const title = screen.getByRole("button", {
    name: i18n.t("plans.selectNode", { name: "Team" }),
  });
  expect(title.className).toContain("cursor-grab");
  fireEvent.click(title);
  expect(graph.select).toHaveBeenLastCalledWith("group");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Team" }),
    }),
  );
  expect(onEdit).toHaveBeenCalledWith("group");
  expect(graph.select).toHaveBeenCalledTimes(2);
  const menu = screen.getByRole("button", {
    name: i18n.t("settings.agents.actionsFor", { name: "Team" }),
  });
  fireEvent.keyDown(menu, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.templates.saveAction"),
    }),
  );
  expect(spies.onSaveTemplate).toHaveBeenCalledWith("group");
  fireEvent.keyDown(menu, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(graph.remove).toHaveBeenCalledWith("group");
});

it("selects the group for editing even without an editor callback", () => {
  const graph = graphStub();
  renderFrame({ graph });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Team" }),
    }),
  );
  expect(graph.select).toHaveBeenCalledWith("group");
});

it("toggles without selecting through the canvas below", () => {
  const spies = renderFrame();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.collapse") }),
  );
  expect(spies.onToggle).toHaveBeenCalledOnce();
  expect(spies.outerClick).not.toHaveBeenCalled();
});

it("shows a collapsed group compactly with a ring, its class and its status", () => {
  const spies = renderFrame({ isCollapsed: true });
  const region = frame();
  expect(region.dataset.collapsed).toBe("true");
  expect(region.className).toContain("rounded-[0.875rem]");
  const expand = screen.getByRole("button", {
    name: i18n.t("plans.groups.expand"),
  });
  expect(expand).toHaveProperty("ariaExpanded", "false");
  expect(region.querySelector("svg circle")).toBeTruthy();
  expect(
    within(region).getByText(i18n.t("plans.groups.state.ready")),
  ).toBeTruthy();
  expect(region.textContent).not.toContain("acp-7");
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Team" }),
    }),
  ).toBeNull();
  fireEvent.click(expand);
  expect(spies.onToggle).toHaveBeenCalledOnce();
});

it("marks a drop target and invites the dragged agent", () => {
  renderFrame({ isDropTarget: true });
  expect(frame().className).toContain("ring-plan-group/40");
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.groups.dropHere"),
  );
});

it("rings a selected group in the selection color, also while it is a drop target", () => {
  renderFrame({
    graph: graphStub({ selectedId: "group" }),
    isDropTarget: true,
  });
  expect(frame().className).toContain("ring-info");
  expect(frame().className).not.toContain("ring-plan-group/40");
});

it("names an unnamed empty group by default and invites members while editable", () => {
  renderFrame({ group: sessionGroup({ name: "" }) });
  const name = i18n.t("plans.groups.defaultName");
  expect(frame(name)).toBeTruthy();
  expect(screen.getByText(i18n.t("plans.groups.empty"))).toBeTruthy();
  expect(
    within(frame(name)).getByText(i18n.t("plans.groups.adapter.neutral")),
  ).toBeTruthy();
});

it("shows a read-only empty group without grab cursor or menu", () => {
  renderFrame({ group: sessionGroup(), canEdit: false });
  expect(screen.getByText(i18n.t("plans.groups.emptyReadOnly"))).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: i18n.t("plans.selectNode", { name: "Session" }),
    }).className,
  ).not.toContain("cursor-grab");
  expect(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Session" }),
    }),
  ).toHaveProperty("disabled", true);
});

it("replaces the session with an unavailable progress after a run error", () => {
  renderFrame({ runError: "name_taken" });
  const region = frame();
  expect(region.textContent).toContain(i18n.t("plans.progress.unavailable"));
  expect(region.textContent).not.toContain("acp-7");
  expect(
    within(region).getByRole("img", {
      name: i18n.t("plans.progress.unknownTotal"),
    }),
  ).toBeTruthy();
});

it("marks a group that needs repair, also for a member's group binding", () => {
  const groupIssue = graphStub({
    issues: [{ nodeId: "group", port: null, reason: "groupBoundary" }],
  });
  renderFrame({ graph: groupIssue, isCollapsed: true });
  const repair = i18n.t("plans.groups.needsRepair");
  expect(screen.getAllByText(repair)).toHaveLength(1);
  expect(screen.getByLabelText(repair)).toBeTruthy();
});

it("marks a member's group binding only in the header, and ignores other member issues", () => {
  const repair = i18n.t("plans.groups.needsRepair");
  const binding = graphStub({
    issues: [{ nodeId: "m2", port: null, reason: "groupBinding" }],
  });
  renderFrame({ graph: binding });
  expect(screen.getByLabelText(repair)).toBeTruthy();
  expect(screen.queryAllByText(repair)).toHaveLength(0);
});

it("does not mark a group for an unrelated member issue", () => {
  renderFrame({
    graph: graphStub({
      issues: [
        { nodeId: "m2", port: null, reason: "required" },
        { nodeId: "elsewhere", port: null, reason: "groupBinding" },
      ],
    }),
  });
  expect(
    screen.queryByLabelText(i18n.t("plans.groups.needsRepair")),
  ).toBeNull();
});
