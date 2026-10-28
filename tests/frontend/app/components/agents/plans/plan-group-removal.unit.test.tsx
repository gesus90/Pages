import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanGroupRemoval } from "@/app/components/agents/plans/plan-group-removal";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  agentNode,
  flowEdge,
  graphStub,
  i18n,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type * as DialogModule from "@/app/components/ui/dialog";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanInput } from "@/definition/AgentPlan";

// The real dialog, recording how it reports open changes; no trigger of these dialogs ever asks to open.
const openChanges = vi.hoisted(() => {
  const changes: ((open: boolean) => void)[] = [];
  return changes;
});
vi.mock("@/app/components/ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  function Dialog(
    props: React.ComponentProps<typeof actual.Dialog>,
  ): React.ReactElement {
    if (props.onOpenChange) openChanges.push(props.onOpenChange);
    return <actual.Dialog {...props} />;
  }
  return { ...actual, Dialog };
});

const PORT = {
  id: "port",
  name: "common",
  type: "text" as const,
  description: "",
  isRequired: true,
  defaultValue: null,
};

const MEMBERS = [agentNode("m1", "codex"), agentNode("m2", "codex")];

function renderRemoval(
  draft: AgentPlanInput,
  graph: PlanGraphActions,
  canEdit = true,
): void {
  renderTranslated(
    <PlanGroupRemoval draft={draft} graph={graph} canEdit={canEdit} />,
  );
}

function button(name: string): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("button", { name });
}

it("offers the frame alone, the frame with its members, or cancel for a group", () => {
  const graph = graphStub({ removalId: "group" });
  renderRemoval(
    planOf([sessionGroup({ name: "Team", steps: MEMBERS })]),
    graph,
  );
  const dialog = screen.getByRole("dialog", {
    name: i18n.t("plans.groups.removeTitle", { name: "Team" }),
  });
  expect(dialog.textContent).toContain(
    i18n.t("plans.groups.removeDescription", { count: 2 }),
  );
  fireEvent.click(button(i18n.t("plans.groups.removeFrame")));
  expect(graph.removeGroup).toHaveBeenLastCalledWith("group", true);
  fireEvent.click(
    button(i18n.t("plans.groups.removeWithMembers", { count: 2 })),
  );
  expect(graph.removeGroup).toHaveBeenLastCalledWith("group", false);
  fireEvent.click(button(i18n.t("settings.agents.cancel")));
  expect(graph.cancelRemoval).toHaveBeenCalledOnce();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(graph.cancelRemoval).toHaveBeenCalledTimes(2);
});

it("keeps a group's members only after its legacy edges and aliases are repaired", () => {
  const frameName = i18n.t("plans.groups.removeFrame");
  const withEdge = planOf(
    [
      sessionGroup({ steps: MEMBERS }),
      { id: "start", type: "start", x: 0, y: 0 },
    ],
    [flowEdge("start", "group")],
  );
  const { unmount } = renderTranslated(
    <PlanGroupRemoval
      draft={withEdge}
      graph={graphStub({ removalId: "group" })}
      canEdit
    />,
  );
  expect(button(frameName)).toHaveProperty("disabled", true);
  expect(button(frameName).title).toBe(
    i18n.t("plans.groups.repairBeforeUngroup"),
  );
  unmount();
  const outgoing = planOf(
    [sessionGroup({ steps: MEMBERS }), { id: "end", type: "end", x: 0, y: 0 }],
    [flowEdge("group", "end")],
  );
  const second = renderTranslated(
    <PlanGroupRemoval
      draft={outgoing}
      graph={graphStub({ removalId: "group" })}
      canEdit
    />,
  );
  expect(button(frameName)).toHaveProperty("disabled", true);
  second.unmount();
  const aliased = sessionGroup({
    parameters: [PORT],
    steps: [
      agentNode("m1", "codex", {
        bindings: { input1: { kind: "source", nodeId: "port" } },
      }),
    ],
  });
  renderRemoval(planOf([aliased]), graphStub({ removalId: "group" }));
  expect(button(frameName)).toHaveProperty("disabled", true);
});

it("removes a loop as a container of nodes", () => {
  const graph = graphStub({ removalId: "loop" });
  const loop = {
    ...emptyPlanLoop("loop", "Repeat", { x: 0, y: 0 }),
    steps: MEMBERS,
  };
  renderRemoval(planOf([loop]), graph);
  expect(
    screen.getByRole("dialog", {
      name: i18n.t("plans.loops.removeTitle", { name: "Repeat" }),
    }),
  ).toBeTruthy();
  const keep = button(i18n.t("plans.loops.removeFrame"));
  expect(keep).toHaveProperty("disabled", false);
  fireEvent.click(keep);
  expect(graph.removeGroup).toHaveBeenCalledWith("loop", true);
  fireEvent.click(
    button(i18n.t("plans.loops.removeWithMembers", { count: 2 })),
  );
  expect(graph.removeGroup).toHaveBeenLastCalledWith("loop", false);
});

it("requires connected loop edges and previous-iteration bindings to be repaired before dissolving", () => {
  const loop = {
    ...emptyPlanLoop("loop", "Repeat", { x: 0, y: 0 }),
    steps: MEMBERS,
  };
  const first = renderTranslated(
    <PlanGroupRemoval
      draft={planOf([loop], [flowEdge("loop", "loop")])}
      graph={graphStub({ removalId: "loop" })}
      canEdit
    />,
  );
  expect(button(i18n.t("plans.loops.removeFrame"))).toHaveProperty(
    "disabled",
    true,
  );
  first.unmount();
  const bound = {
    ...loop,
    steps: [
      agentNode("m1", "codex", {
        bindings: { input1: { kind: "previous", stepId: "m1" } },
      }),
    ],
  };
  renderRemoval(planOf([bound]), graphStub({ removalId: "loop" }));
  expect(button(i18n.t("plans.loops.removeFrame"))).toHaveProperty(
    "disabled",
    true,
  );
});

it("stays closed without a frame to remove or without the right to edit", () => {
  const draft = planOf([
    sessionGroup({ steps: MEMBERS }),
    agentNode("a", "codex"),
  ]);
  for (const graph of [
    graphStub(),
    graphStub({ removalId: "a" }),
    graphStub({ removalId: "unknown" }),
  ]) {
    const { unmount } = renderTranslated(
      <PlanGroupRemoval draft={draft} graph={graph} canEdit />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
  }
  renderRemoval(draft, graphStub({ removalId: "group" }), false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("never removes a frame without an identifier", () => {
  const graph = graphStub({ removalId: "" });
  renderRemoval(planOf([sessionGroup({ id: "", steps: MEMBERS })]), graph);
  fireEvent.click(button(i18n.t("plans.groups.removeFrame")));
  fireEvent.click(
    button(i18n.t("plans.groups.removeWithMembers", { count: 2 })),
  );
  expect(graph.removeGroup).not.toHaveBeenCalled();
});

it("does not cancel the removal when the dialog only reports that it is open", () => {
  const graph = graphStub({ removalId: "group" });
  renderRemoval(planOf([sessionGroup({ steps: MEMBERS })]), graph);
  openChanges.at(-1)?.(true);
  expect(graph.cancelRemoval).not.toHaveBeenCalled();
  openChanges.at(-1)?.(false);
  expect(graph.cancelRemoval).toHaveBeenCalledOnce();
});
