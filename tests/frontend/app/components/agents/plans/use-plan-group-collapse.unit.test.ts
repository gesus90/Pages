import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { usePlanGroupCollapse } from "@/app/components/agents/plans/use-plan-group-collapse";

import {
  agentStep,
  graphActions,
  groupNode,
  planOf,
} from "./plan-flow-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanInput } from "@/definition/AgentPlan";

interface CollapseProps {
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
}

const DRAFT = planOf([
  groupNode("group", [agentStep("member")]),
  agentStep("outside"),
]);

function mount(
  graph: PlanGraphActions,
): RenderHookResult<ReturnType<typeof usePlanGroupCollapse>, CollapseProps> {
  return renderHook(
    (props: CollapseProps) => usePlanGroupCollapse(props.draft, props.graph),
    { initialProps: { draft: DRAFT, graph } },
  );
}

it("collapses only groups", () => {
  const graph = graphActions();
  const { result } = mount(graph);
  act(() => result.current.toggleGroup("outside"));
  act(() => result.current.toggleGroup("missing"));
  expect(result.current.collapsedGroups.size).toBe(0);
});

it("selects a collapsed group instead of its member and the member again on expanding", () => {
  const memberSelected = graphActions({ selectedId: "member" });
  const { result, rerender } = mount(memberSelected);
  act(() => result.current.toggleGroup("group"));
  expect([...result.current.collapsedGroups]).toEqual(["group"]);
  expect(memberSelected.select).toHaveBeenCalledWith("group");
  const groupSelected = graphActions({ selectedId: "group" });
  rerender({ draft: DRAFT, graph: groupSelected });
  act(() => result.current.toggleGroup("group"));
  expect(result.current.collapsedGroups.size).toBe(0);
  expect(groupSelected.select).toHaveBeenCalledWith("member");
});

it("keeps the selection when nothing inside the group was selected", () => {
  const nothing = graphActions();
  const { result, rerender } = mount(nothing);
  act(() => result.current.toggleGroup("group"));
  const outside = graphActions({ selectedId: "outside" });
  rerender({ draft: DRAFT, graph: outside });
  act(() => result.current.toggleGroup("group"));
  act(() => result.current.toggleGroup("group"));
  const groupSelected = graphActions({ selectedId: "group" });
  rerender({ draft: DRAFT, graph: groupSelected });
  act(() => result.current.toggleGroup("group"));
  expect(nothing.select).not.toHaveBeenCalled();
  expect(outside.select).not.toHaveBeenCalled();
  expect(groupSelected.select).not.toHaveBeenCalled();
});

it("does not restore a member that was moved away or after the selection changed", () => {
  const memberSelected = graphActions({ selectedId: "member" });
  const { result, rerender } = mount(memberSelected);
  act(() => result.current.toggleGroup("group"));
  const elsewhere = graphActions({ selectedId: "outside" });
  rerender({ draft: DRAFT, graph: elsewhere });
  act(() => result.current.toggleGroup("group"));
  expect(elsewhere.select).not.toHaveBeenCalled();
  rerender({ draft: DRAFT, graph: memberSelected });
  act(() => result.current.toggleGroup("group"));
  const emptied = planOf([groupNode("group", []), agentStep("outside")]);
  const groupSelected = graphActions({ selectedId: "group" });
  rerender({ draft: emptied, graph: groupSelected });
  act(() => result.current.toggleGroup("group"));
  expect(groupSelected.select).not.toHaveBeenCalled();
});
