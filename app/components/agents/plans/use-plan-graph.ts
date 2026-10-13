import { useState } from "react";

import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentParameterValue } from "@/definition/AgentParameters";

/** Editable node operations and validated port interactions of one plan draft. */
export interface PlanGraphActions {
  readonly issues: readonly AgentPlanIssue[];
  readonly connectionIssue: ReturnType<
    typeof usePlanConnections
  >["connectionIssue"];
  readonly selectedId: string | null;
  readonly select: (id: string | null) => void;
  readonly connection: ReturnType<typeof usePlanConnections>["connection"];
  readonly begin: ReturnType<typeof usePlanConnections>["begin"];
  readonly connect: ReturnType<typeof usePlanConnections>["connect"];
  readonly bindSource: ReturnType<typeof usePlanConnections>["bindSource"];
  readonly add: (
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ) => string | null;
  readonly move: (id: string, x: number, y: number) => void;
  readonly remove: (id: string) => void;
  readonly replaceStep: (step: AgentPlanStep) => void;
  readonly replaceNode: (node: AgentPlanNode) => void;
  readonly insertValue: (
    step: AgentPlanStep,
    name: string,
    value: AgentParameterValue,
  ) => void;
}

/** Graph edits leave definitions untouched; the plan owns every node instance and binding. */
export function usePlanGraph(
  draft: AgentPlanInput,
  setDraft: Dispatch<SetStateAction<AgentPlanInput>>,
  sources: AgentPlanSources,
): PlanGraphActions {
  const [selectedId, select] = useState<string | null>(null);
  const connections = usePlanConnections(draft, setDraft, sources);
  function add(
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ): string | null {
    const node = createPlanNode({ draft, sources, kind, reference, position });
    if (!node) return null;
    const additions = nodeWithDefaults(node, draft, sources);
    setDraft((previous) => ({
      ...previous,
      nodes: [...previous.nodes, ...additions],
    }));
    select(node.id);
    return node.id;
  }
  function move(id: string, x: number, y: number): void {
    setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.id === id
          ? { ...node, x: snapPlanCoordinate(x), y: snapPlanCoordinate(y) }
          : node,
      ),
    }));
  }
  function remove(id: string): void {
    setDraft((previous) => removePlanNode(previous, id));
    if (selectedId === id) select(null);
    if (connections.connection?.nodeId === id) connections.begin(null);
  }
  function replaceNode(step: AgentPlanNode): void {
    setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => (node.id === step.id ? step : node)),
    }));
  }
  function insertValue(
    step: AgentPlanStep,
    name: string,
    value: AgentParameterValue,
  ): void {
    const source = createPlanNode({
      draft,
      sources,
      kind: "parameter",
      reference: name,
      position: { x: Math.max(0, step.x - 320), y: step.y + 340 },
    });
    if (source?.type !== "parameter") return;
    const next = {
      ...step,
      bindings: {
        ...step.bindings,
        [name]: { kind: "source" as const, nodeId: source.id },
      },
    };
    setDraft((previous) => ({
      ...previous,
      nodes: [
        ...previous.nodes.map((node) => (node.id === step.id ? next : node)),
        { ...source, value },
      ],
    }));
    select(source.id);
  }
  return {
    insertValue,
    issues: planExecutionIssues(draft, sources.agents),
    selectedId,
    select,
    ...connections,
    add,
    move,
    remove,
    replaceStep: replaceNode,
    replaceNode,
  };
}

/** Existing defaults become visible, individually connected value nodes. */
function nodeWithDefaults(
  node: AgentPlanNode,
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): readonly AgentPlanNode[] {
  if (node.type !== "agent") return [node];
  const configuration = sources.agents.find(
    (agent) => agent.id === node.agentId,
  )?.configuration;
  if (!configuration) return [node];
  const parameters: AgentPlanNode[] = [];
  const bindings = { ...node.bindings };
  for (const parameter of configuration.parameters) {
    const value =
      parameter.defaultValue ??
      (parameter.name === configuration.directoryParameter
        ? { type: "workspace" as const, workspaceId: draft.workspaceId }
        : null);
    if (!value) continue;
    const source = createPlanNode({
      draft,
      sources,
      kind: "parameter",
      reference: parameter.name,
      position: {
        x: Math.max(0, node.x - 320),
        y: node.y + 340 + parameters.length * 160,
      },
    });
    if (source?.type !== "parameter") continue;
    parameters.push({ ...source, value });
    bindings[parameter.name] = { kind: "source", nodeId: source.id };
  }
  return [{ ...node, bindings }, ...parameters];
}
