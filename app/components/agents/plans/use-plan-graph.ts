import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { planLinkKey, removePlanLink } from "./plan-links";
import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";
import { usePlanSelection } from "./use-plan-selection";

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
import type { PlanLink } from "./plan-links";
import type { PlanSelection } from "./use-plan-selection";

/** Editable node operations and validated port interactions of one plan draft. */
export interface PlanGraphActions extends PlanSelection {
  readonly issues: readonly AgentPlanIssue[];
  readonly connectionIssue: ReturnType<
    typeof usePlanConnections
  >["connectionIssue"];
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
  /** Removes a node together with every connection that reaches it. */
  readonly remove: (id: string) => void;
  /** Removes one connection and keeps both of its nodes. */
  readonly disconnect: (link: PlanLink) => void;
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
  const selection = usePlanSelection();
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
    selection.select(node.id);
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
    const link = selection.selectedLink;
    if (selection.selectedId === id || link?.from === id || link?.to === id)
      selection.select(null);
    if (connections.connection?.nodeId === id) connections.begin(null);
  }
  function disconnect(link: PlanLink): void {
    setDraft((previous) => removePlanLink(previous, link));
    if (
      selection.selectedLink &&
      planLinkKey(selection.selectedLink) === planLinkKey(link)
    )
      selection.selectLink(null);
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
    selection.select(source.id);
  }
  return {
    insertValue,
    issues: planExecutionIssues(draft, sources.agents),
    ...selection,
    ...connections,
    add,
    move,
    remove,
    disconnect,
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
