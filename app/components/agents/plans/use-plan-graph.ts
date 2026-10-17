import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { findPlanStep, replacePlanNode } from "@/definition/AgentPlanGroupEdit";

import { planLinkKey, removePlanLink } from "./plan-links";
import { planNodeBox } from "./plan-layout";
import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";
import { usePlanGroupActions } from "./use-plan-group-actions";
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
import type { PlanGroupActions } from "./use-plan-group-actions";

/** Editable node operations and validated port interactions of one plan draft. */
export interface PlanGraphActions extends PlanSelection, PlanGroupActions {
  readonly insertionError: string | null;
  readonly isInserting: boolean;
  readonly issues: readonly AgentPlanIssue[];
  readonly connectionIssue: ReturnType<
    typeof usePlanConnections
  >["connectionIssue"];
  readonly connection: ReturnType<typeof usePlanConnections>["connection"];
  readonly begin: ReturnType<typeof usePlanConnections>["begin"];
  readonly connect: ReturnType<typeof usePlanConnections>["connect"];
  readonly canConnect: ReturnType<typeof usePlanConnections>["canConnect"];
  readonly bindSource: ReturnType<typeof usePlanConnections>["bindSource"];
  readonly canConnectFrom: ReturnType<
    typeof usePlanConnections
  >["canConnectFrom"];
  readonly connectFrom: ReturnType<typeof usePlanConnections>["connectFrom"];
  /** Adds a node; with `groupId` an agent joins that group, if it may. */
  readonly add: (
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
    groupId?: string,
  ) => string | null;
  /** Moves a node; a member's position counts from its frame's member area. */
  readonly move: (id: string, x: number, y: number) => void;
  /**
   * Removes a node together with every connection that reaches it.
   *
   * @remarks
   * A frame with members is not removed at once: it waits for the choice
   * between keeping and deleting its members.
   */
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

/** A new value node beside an agent node, inside a frame too, bound to one of its inputs. */
function boundValueNode(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  request: {
    readonly step: AgentPlanStep;
    readonly name: string;
    readonly value: AgentParameterValue;
  },
): { readonly node: AgentPlanNode; readonly step: AgentPlanStep } | null {
  const { step, name, value } = request;
  const box = planNodeBox(draft, step.id, sources);
  const source = createPlanNode({
    draft,
    sources,
    kind: "parameter",
    reference: name,
    position: {
      x: Math.max(0, (box?.x ?? step.x) - 320),
      y: (box?.y ?? step.y) + 340,
    },
  });
  if (source?.type !== "parameter") return null;
  return {
    node: { ...source, value },
    step: {
      ...step,
      bindings: {
        ...step.bindings,
        [name]: { kind: "source", nodeId: source.id },
      },
    },
  };
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
  const groups = usePlanGroupActions({
    draft,
    setDraft,
    sources,
    onRemoved: forget,
  });
  const insertion = usePlanNodeInsertion({
    draft,
    setDraft,
    sources,
    select: selection.select,
    loadConfiguration,
    onRefused: groups.refuse,
  });
  function forget(id: string): void {
    const link = selection.selectedLink;
    if (selection.selectedId === id || link?.from === id || link?.to === id)
      selection.select(null);
    if (connections.connection?.nodeId === id) connections.begin(null);
  }
  function move(id: string, x: number, y: number): void {
    const node =
      findPlanStep(draft, id)?.step ??
      draft.nodes.find((entry) => entry.id === id);
    if (!node) return;
    setDraft((previous) =>
      replacePlanNode(previous, {
        ...node,
        x: snapPlanCoordinate(x),
        y: snapPlanCoordinate(y),
      }),
    );
  }
  function remove(id: string): void {
    const node = draft.nodes.find((entry) => entry.id === id);
    if (node?.type === "group" && node.steps.length > 0) {
      groups.requestRemoval(id);
      return;
    }
    setDraft((previous) => removePlanNode(previous, id));
    forget(id);
  }
  function disconnect(link: PlanLink): void {
    setDraft((previous) => removePlanLink(previous, link));
    if (
      selection.selectedLink &&
      planLinkKey(selection.selectedLink) === planLinkKey(link)
    )
      selection.selectLink(null);
  }
  function replaceNode(node: AgentPlanNode): void {
    setDraft((previous) => replacePlanNode(previous, node));
  }
  function insertValue(
    step: AgentPlanStep,
    name: string,
    value: AgentParameterValue,
  ): void {
    const bound = boundValueNode(draft, sources, { step, name, value });
    if (!bound) return;
    setDraft((previous) => {
      const replaced = replacePlanNode(previous, bound.step);
      return { ...replaced, nodes: [...replaced.nodes, bound.node] };
    });
    selection.select(bound.node.id);
  }
  return {
    insertValue,
    issues: planExecutionIssues(draft, sources.agents),
    ...selection,
    ...connections,
    ...insertion,
    ...groups,
    move,
    remove,
    disconnect,
    replaceStep: replaceNode,
    replaceNode,
  };
}
