import { ReactFlowProvider } from "@xyflow/react";
import { I18nextProvider } from "react-i18next";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { createI18n } from "@/app/lib/i18n";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import type { RenderResult } from "@testing-library/react";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** The German translations the plan editor shows. */
export const i18n = createI18n("de");

/** Sources without agents or tickets; nodes then fall back to their type names. */
export const EMPTY_SOURCES: AgentPlanSources = { agents: [], tasks: [] };

/** A flow edge from the OUT of `from` to the IN of `to`. */
export function flow(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "flow-out", toPort: "flow-in" };
}

/** An agent node at the origin; a member's position counts from its frame. */
export function agentStep(
  id: string,
  bindings: Readonly<Record<string, AgentPlanBinding>> = {},
): AgentPlanStep {
  return {
    id,
    type: "agent",
    x: 0,
    y: 0,
    agentId: "",
    personalAgentId: null,
    instruction: "",
    bindings,
  };
}

/** A script node with the given number of text outputs. */
export function scriptStep(id: string, outputs: number): AgentPlanScript {
  return {
    id,
    type: "script",
    name: `Script ${id}`,
    x: 0,
    y: 0,
    interpreterProfileId: "bash",
    content: "echo",
    inputs: [],
    outputs: Array.from({ length: outputs }, (_, index) => ({
      name: `out${index + 1}`,
      type: "text" as const,
    })),
    timeoutSeconds: 60,
    bindings: {},
  };
}

/** A legacy session group with its members, internal edges and boundary ports. */
export function groupNode(
  id: string,
  steps: readonly AgentPlanStep[],
  overrides: Partial<AgentPlanGroup> = {},
): AgentPlanGroup {
  return {
    id,
    type: "group",
    name: `Group ${id}`,
    x: 100,
    y: 200,
    steps,
    edges: [],
    parameters: [],
    bindings: {},
    ...overrides,
  };
}

/** A loop of the given members, chained by `edges`. */
export function loopNode(
  id: string,
  steps: readonly AgentPlanLoopMember[],
  edges: readonly AgentPlanEdge[] = [],
): AgentPlanLoop {
  return { ...emptyPlanLoop(id, `Loop ${id}`, { x: 40, y: 80 }), steps, edges };
}

/** A plan of the given nodes and outer edges. */
export function planOf(
  nodes: readonly AgentPlanNode[],
  edges: readonly AgentPlanEdge[] = [],
): AgentPlanInput {
  return {
    name: "Flow plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes,
    edges,
  };
}

/** Graph actions whose every action is a spy; nothing is selected or connecting. */
export function graphActions(
  overrides: Partial<PlanGraphActions> = {},
): PlanGraphActions {
  return {
    selectedId: null,
    selectedLink: null,
    select: vi.fn(),
    selectLink: vi.fn(),
    notice: null,
    clearNotice: vi.fn(),
    removalId: null,
    requestRemoval: vi.fn(),
    cancelRemoval: vi.fn(),
    removeGroup: vi.fn(),
    place: vi.fn(),
    assign: vi.fn(),
    refuse: vi.fn(),
    insertionError: null,
    issues: [],
    connectionIssue: null,
    connection: null,
    begin: vi.fn(),
    connect: vi.fn(),
    canConnect: vi.fn(() => true),
    canConnectFrom: vi.fn(() => true),
    connectFrom: vi.fn(),
    add: vi.fn(),
    addScript: vi.fn(),
    insertTemplate: vi.fn(),
    isMoving: false,
    registerPendingMove: vi.fn(),
    hasPendingMove: vi.fn(() => false),
    flushPendingMove: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    disconnect: vi.fn(),
    resolveGroupEdge: vi.fn(),
    replaceStep: vi.fn(),
    replaceNode: vi.fn(),
    ...overrides,
  };
}

/** The canvas context of an editable, never run plan; `overrides` change single entries. */
export function flowContext(
  overrides: Partial<PlanFlowContextValue> = {},
): PlanFlowContextValue {
  return {
    draft: planOf([]),
    sources: EMPTY_SOURCES,
    graph: graphActions(),
    canEdit: true,
    run: null,
    collapsedGroups: new Set(),
    toggleGroup: vi.fn(),
    dropTarget: null,
    cancelConnection: vi.fn(),
    requestTemplate: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders an element with German translations inside a React Flow store and
 * the given canvas context, as the plan canvas places its nodes.
 */
export function renderInFlow(
  element: React.ReactElement,
  context: PlanFlowContextValue = flowContext(),
): RenderResult {
  return render(
    <I18nextProvider i18n={i18n}>
      <ReactFlowProvider>
        <PlanFlowContext.Provider value={context}>
          {element}
        </PlanFlowContext.Provider>
      </ReactFlowProvider>
    </I18nextProvider>,
  );
}

/** Renders an element with the German translations only. */
export function renderTranslated(element: React.ReactElement): RenderResult {
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}
