import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { planLinkKey, removePlanLink } from "./plan-links";
import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";
import { usePlanNodeInsertion } from "./use-plan-node-insertion";
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
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { PlanLink } from "./plan-links";
import type { PlanSelection } from "./use-plan-selection";

/** Editable node operations and validated port interactions of one plan draft. */
export interface PlanGraphActions extends PlanSelection {
  readonly insertionError: string | null;
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
  loadConfiguration?: (id: string) => Promise<AgentPlanConfiguration>,
): PlanGraphActions {
  const selection = usePlanSelection();
  const connections = usePlanConnections(draft, setDraft, sources);
  const insertion = usePlanNodeInsertion({
    draft,
    setDraft,
    sources,
    select: selection.select,
    loadConfiguration,
  });
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
    ...insertion,
    move,
    remove,
    disconnect,
    replaceStep: replaceNode,
    replaceNode,
  };
}
