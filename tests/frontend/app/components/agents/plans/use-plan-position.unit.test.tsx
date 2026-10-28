import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { planMemberPosition } from "@/app/components/agents/plans/plan-layout";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  GROUP_SOURCES,
  agentNode,
  planOf,
  sessionGroup,
} from "./plan-group-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";

function useDraft(initial: AgentPlanInput): {
  readonly draft: AgentPlanInput;
  readonly graph: ReturnType<typeof usePlanGraph>;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
} {
  const [draft, setDraft] = useState(initial);
  return {
    draft,
    graph: usePlanGraph(draft, setDraft, GROUP_SOURCES),
    setDraft,
  };
}

it("keeps an explicitly moved coordinate without rounding it to a grid", () => {
  const initial = planOf([agentNode("agent", "codex")]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => result.current.graph.move("agent", 197, 243));

  expect(result.current.draft.nodes[0]).toMatchObject({ x: 197, y: 243 });
});

it("keeps concurrent node edits when a move is queued in the same render", () => {
  const initial = planOf([agentNode("agent", "codex")]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "agent" ? { ...node, instruction: "new text" } : node,
      ),
    }));
    result.current.graph.move("agent", 197, 243);
  });

  expect(result.current.draft.nodes[0]).toMatchObject({
    instruction: "new text",
    x: 197,
    y: 243,
  });
});

it("keeps concurrent node edits when a drag ends outside any frame", () => {
  const initial = planOf([agentNode("agent", "codex")]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "agent" ? { ...node, instruction: "new text" } : node,
      ),
    }));
    result.current.graph.place("agent", {
      pointer: { x: 197, y: 243 },
      position: { x: 197, y: 243 },
    });
  });

  expect(result.current.draft.nodes[0]).toMatchObject({
    instruction: "new text",
    x: 197,
    y: 243,
  });
});

it("keeps a queued instruction edit when moving an agent into a group", () => {
  const initial = planOf([
    sessionGroup({ steps: [] }),
    agentNode("agent", "codex"),
  ]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "agent" ? { ...node, instruction: "new text" } : node,
      ),
    }));
    result.current.graph.assign("agent", "group");
  });

  const group = result.current.draft.nodes.find((node) => node.id === "group");
  expect(group?.type).toBe("group");
  if (group?.type !== "group") throw new Error("Synthetic group missing");
  expect(group.steps[0]).toMatchObject({
    id: "agent",
    instruction: "new text",
  });
});

it("keeps a queued instruction edit when dropping an agent into a loop", () => {
  const initial = planOf([
    emptyPlanLoop("loop", "Loop", { x: 0, y: 0 }),
    agentNode("agent", "codex", { x: 900, y: 0 }),
  ]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "agent" ? { ...node, instruction: "new text" } : node,
      ),
    }));
    result.current.graph.place("agent", {
      pointer: { x: 300, y: 200 },
      position: { x: 240, y: 180 },
    });
  });

  const loop = result.current.draft.nodes.find((node) => node.id === "loop");
  expect(loop?.type).toBe("loop");
  if (loop?.type !== "loop") throw new Error("Synthetic loop missing");
  expect(loop.steps[0]).toMatchObject({ id: "agent", instruction: "new text" });
});

it("keeps a pointer position when adding a new node", () => {
  const initial = planOf([agentNode("agent", "codex")]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.graph.add("start", "", { x: 137, y: 249 });
  });

  expect(
    result.current.draft.nodes.find((node) => node.type === "start"),
  ).toMatchObject({ x: 137, y: 249 });
  expect(result.current.draft.nodes[0]).toEqual(initial.nodes[0]);
});

it("keeps a member's absolute position when its group is dissolved", () => {
  const member = agentNode("agent", "codex", { x: 37, y: 59 });
  const group = sessionGroup({ x: 101, y: 203, steps: [member] });
  const initial = planOf([group]);
  const position = planMemberPosition(group, member);
  const { result } = renderHook(() => useDraft(initial));

  act(() => result.current.graph.removeGroup("group", true));

  expect(
    result.current.draft.nodes.find((node) => node.id === member.id),
  ).toMatchObject(position);
});

it("keeps a queued member edit while dissolving its group", () => {
  const initial = planOf([
    sessionGroup({ steps: [agentNode("agent", "codex")] }),
  ]);
  const { result } = renderHook(() => useDraft(initial));

  act(() => {
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "group"
          ? {
              ...node,
              steps: node.steps.map((step) => ({
                ...step,
                instruction: "new text",
              })),
            }
          : node,
      ),
    }));
    result.current.graph.removeGroup("group", true);
  });

  expect(
    result.current.draft.nodes.find((node) => node.id === "agent"),
  ).toMatchObject({ instruction: "new text" });
});

it("clears a selected member and connection source when its group is deleted", () => {
  const initial = planOf([
    sessionGroup({ steps: [agentNode("agent", "codex")] }),
  ]);
  const { result } = renderHook(() => useDraft(initial));
  act(() => result.current.graph.select("agent"));
  act(() => result.current.graph.begin({ kind: "result", nodeId: "agent" }));

  act(() => result.current.graph.removeGroup("group", false));

  expect(result.current.graph.selectedId).toBeNull();
  expect(result.current.graph.connection).toBeNull();
});

it("clears a selected data link when its named input is rebound to another source", () => {
  const source = {
    type: "parameter" as const,
    x: 0,
    y: 0,
    name: "source",
    format: "string" as const,
    value: { type: "text" as const, text: "value" },
  };
  const initial = planOf([
    { ...source, id: "first" },
    { ...source, id: "second" },
    agentNode("agent", "codex", {
      bindings: { input1: { kind: "source", nodeId: "first" } },
    }),
  ]);
  const { result } = renderHook(() => useDraft(initial));
  act(() =>
    result.current.graph.selectLink({
      kind: "data",
      from: "first",
      to: "agent",
      parameter: "input1",
    }),
  );

  act(() =>
    result.current.setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.type === "agent"
          ? {
              ...node,
              bindings: { input1: { kind: "source", nodeId: "second" } },
            }
          : node,
      ),
    })),
  );

  expect(result.current.graph.selectedLink).toBeNull();
});
