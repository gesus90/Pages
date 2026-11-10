import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import { usePlanGroupActions } from "@/app/components/agents/plans/use-plan-group-actions";

import { GROUP_SOURCES } from "./plan-group-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type {
  PlanGroupActions,
  PlanDrop,
} from "@/app/components/agents/plans/use-plan-group-actions";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

/** A drop whose pointer and node corner are the same grid point. */
export function dropAt(x: number, y: number): PlanDrop {
  return { pointer: { x, y }, position: { x, y } };
}

interface GroupActionsScene {
  readonly hook: RenderHookResult<
    { readonly draft: AgentPlanInput; readonly actions: PlanGroupActions },
    unknown
  >;
  readonly removed: string[];
  /** The latest draft after every queued update was applied. */
  draft(): AgentPlanInput;
  actions(): PlanGroupActions;
  /** Runs an action inside `act`, as an event handler of the canvas would. */
  run(action: (actions: PlanGroupActions) => void): void;
}

/** Mounts the hook on a real draft state, so what a person would see after an action can be read. */
export function mountGroupActions(
  initial: AgentPlanInput,
  options: { readonly currentDraft?: () => AgentPlanInput } = {},
): GroupActionsScene {
  const removed: string[] = [];
  const hook = renderHook(() => {
    const [draft, setDraft] = useState(initial);
    const actions = usePlanGroupActions({
      draft,
      setDraft,
      sources: GROUP_SOURCES,
      currentDraft: options.currentDraft,
      onRemoved: (id) => removed.push(id),
    });
    return { draft, actions };
  });
  return {
    hook,
    removed,
    draft: () => hook.result.current.draft,
    actions: () => hook.result.current.actions,
    run: (action) => act(() => action(hook.result.current.actions)),
  };
}

/**
 * Mounts the hook on a draft setter that only records its updates.
 *
 * @remarks
 * A queued update runs against the draft of its own time. Calling the recorded
 * update with another plan shows what a concurrent edit does to a move.
 */
export function mountRecordedActions(initial: AgentPlanInput): {
  readonly hook: ReturnType<typeof mountGroupActions>["hook"];
  readonly setDraft: ReturnType<typeof vi.fn>;
  readonly removed: string[];
  /** Applies the last recorded update to `previous`. */
  settle(previous: AgentPlanInput): AgentPlanInput;
} {
  const setDraft = vi.fn();
  const removed: string[] = [];
  const hook = renderHook(() => ({
    draft: initial,
    actions: usePlanGroupActions({
      draft: initial,
      setDraft,
      sources: GROUP_SOURCES,
      onRemoved: (id) => removed.push(id),
    }),
  }));
  return {
    hook,
    setDraft,
    removed,
    settle: (previous) => {
      const update: unknown = setDraft.mock.lastCall?.[0];
      if (typeof update !== "function")
        throw new Error("No draft update was queued");
      return (update as (plan: AgentPlanInput) => AgentPlanInput)(previous);
    },
  };
}

/** A loop with members, without edges, at the grid corner given by `x` and `y`. */
export function loopWith(
  members: AgentPlanLoop["steps"],
  overrides: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return {
    id: "loop",
    type: "loop",
    name: "Review loop",
    x: 0,
    y: 640,
    steps: members,
    edges: [],
    runs: 3,
    runsSource: "value",
    bindings: {},
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
    ...overrides,
  };
}

/** An agent, group or loop of the plan by its ID, also inside a frame; throws when it is gone. */
export function stepOf(
  plan: AgentPlanInput,
  id: string,
): AgentPlanStep | AgentPlanGroup | AgentPlanLoop {
  function search(
    nodes: readonly (AgentPlanNode | AgentPlanLoop["steps"][number])[],
  ): AgentPlanStep | AgentPlanGroup | AgentPlanLoop | null {
    for (const node of nodes) {
      if (
        node.id === id &&
        (node.type === "agent" || node.type === "group" || node.type === "loop")
      )
        return node;
      if (node.type !== "group" && node.type !== "loop") continue;
      const found = search(node.steps);
      if (found) return found;
    }
    return null;
  }
  const found = search(plan.nodes);
  if (!found) throw new Error(`No node ${id} in the plan`);
  return found;
}
