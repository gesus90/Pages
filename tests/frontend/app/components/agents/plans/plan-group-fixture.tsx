import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { RenderResult } from "@testing-library/react";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** A German translation instance, as the plan editor shows its texts. */
export const i18n = createI18n("de");

/** A flow edge between two nodes of the outer graph or of one frame. */
export function flowEdge(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "flow-out", toPort: "flow-in" };
}

function agent(
  id: string,
  name: string,
  options: {
    readonly provider: AgentProviderId | null;
    readonly inputs: number;
    readonly isUsable?: boolean;
  },
): AgentDefinitionChoice {
  return {
    id,
    name,
    model: `${id}-model`,
    reasoningEffort: null,
    provider: options.provider,
    purposes: ["agent"],
    revision: 1,
    configuration: {
      ...emptyAgentConfiguration(),
      parameters: Array.from({ length: options.inputs }, (_, index) => ({
        name: `input${index + 1}`,
        type: "text" as const,
        description: "",
        isRequired: false,
        defaultValue: null,
      })),
    },
    availability: {
      isUsable: options.isUsable ?? true,
      reason: null,
      personalChoices: [],
    },
  };
}

/**
 * Two Codex agents with one and two inputs, a Claude Code agent, an API agent
 * and an unusable Codex agent; one ticket.
 */
export const GROUP_SOURCES: AgentPlanSources = {
  agents: [
    agent("codex", "Codex One", { provider: "codex_cli", inputs: 1 }),
    agent("codex-two", "Codex Two", { provider: "codex_cli", inputs: 2 }),
    agent("claude", "Claude", { provider: "claude_code", inputs: 0 }),
    agent("api", "Api", { provider: "openrouter", inputs: 0 }),
    agent("broken", "Broken", {
      provider: "codex_cli",
      inputs: 0,
      isUsable: false,
    }),
  ],
  tasks: [
    {
      id: "task-1",
      key: "SYN-1",
      title: "Open work",
      type: "task",
      parentId: null,
      statusKey: "todo",
      statusName: "To Do",
      isDone: false,
      createdAt: "2026-01-01 08:00:00",
      updatedAt: "2026-01-02 09:00:00",
    },
  ],
};

/** An agent node of the given agent; its position counts from a frame when it is a member. */
export function agentNode(
  id: string,
  agentId: string,
  overrides: Partial<AgentPlanStep> = {},
): AgentPlanStep {
  return {
    id,
    type: "agent",
    x: 0,
    y: 0,
    agentId,
    personalAgentId: null,
    instruction: "",
    bindings: {},
    ...overrides,
  };
}

/** A node's own copy of an agent, named `name`, with `inputs` text inputs. */
export function ownCopy(name: string, inputs: number): AgentPlanConfiguration {
  return {
    name,
    revision: 1,
    modelProfileId: "copy",
    model: "copy-model",
    provider: "codex_cli",
    reasoningEffort: null,
    template: {
      ...emptyAgentConfiguration(),
      parameters: Array.from({ length: inputs }, (_, index) => ({
        name: `copy${index + 1}`,
        type: "text" as const,
        description: "",
        isRequired: false,
        defaultValue: null,
      })),
    },
  };
}

/** A script node with `inputs` declared text inputs. */
export function scriptNode(
  id: string,
  inputs: number,
  bindings: Readonly<Record<string, AgentPlanBinding>> = {},
): AgentPlanScript {
  return {
    id,
    type: "script",
    name: `Script ${id}`,
    x: 0,
    y: 0,
    interpreterProfileId: "bash",
    content: "echo",
    inputs: Array.from({ length: inputs }, (_, index) => ({
      name: `in${index + 1}`,
      type: "text" as const,
      isRequired: false,
    })),
    outputs: [],
    timeoutSeconds: 60,
    bindings,
  };
}

/** A named session group without members, ports or bindings. */
export function sessionGroup(
  overrides: Partial<AgentPlanGroup> = {},
): AgentPlanGroup {
  return {
    id: "group",
    type: "group",
    name: "Session",
    x: 0,
    y: 0,
    steps: [],
    parameters: [],
    bindings: {},
    ...overrides,
  };
}

/** A plan of the given nodes and outer edges in workspace `workspace`. */
export function planOf(
  nodes: readonly AgentPlanNode[],
  edges: readonly AgentPlanEdge[] = [],
): AgentPlanInput {
  return {
    name: "Group plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes,
    edges,
  };
}

/** Graph actions whose every action is a spy; nothing is selected or pending. */
export function graphStub(
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

function Translated({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** Renders an element with the German translations, also on every rerender. */
export function renderTranslated(element: React.ReactElement): RenderResult {
  return render(element, { wrapper: Translated });
}

/** The flow context of a canvas that shows `draft` without a run, nothing collapsed or dragged. */
export function flowContext(
  draft: AgentPlanInput,
  overrides: Partial<PlanFlowContextValue> = {},
): PlanFlowContextValue {
  return {
    draft,
    sources: GROUP_SOURCES,
    graph: graphStub(),
    canEdit: true,
    run: null,
    collapsedGroups: new Set<string>(),
    toggleGroup: vi.fn(),
    dropTarget: null,
    cancelConnection: vi.fn(),
    requestTemplate: vi.fn(),
    ...overrides,
  };
}
