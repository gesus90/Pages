import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { findPlanStep, replacePlanNode } from "@/definition/AgentPlanGroupEdit";

import { planLinkKey, removePlanLink } from "./plan-links";
import { removePlanNode, snapPlanCoordinate } from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";
import { usePlanGroupActions } from "./use-plan-group-actions";
import { usePlanNodeInsertion } from "./use-plan-node-insertion";
import { usePlanSelection } from "./use-plan-selection";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PlanLink } from "./plan-links";
import type { PlanSelection } from "./use-plan-selection";
import type { PlanGroupActions } from "./use-plan-group-actions";
import type { PlanNodeInsertion } from "./use-plan-node-insertion";

/** Editable node operations and validated port interactions of one plan draft. */
export interface PlanGraphActions extends PlanSelection, PlanGroupActions {
  readonly insertionError: string | null;
  readonly issues: readonly AgentPlanIssue[];
  readonly connectionIssue: ReturnType<
    typeof usePlanConnections
  >["connectionIssue"];
  readonly connection: ReturnType<typeof usePlanConnections>["connection"];
  readonly begin: ReturnType<typeof usePlanConnections>["begin"];
  readonly connect: ReturnType<typeof usePlanConnections>["connect"];
  readonly canConnect: ReturnType<typeof usePlanConnections>["canConnect"];
  readonly canConnectFrom: ReturnType<
    typeof usePlanConnections
  >["canConnectFrom"];
  readonly connectFrom: ReturnType<typeof usePlanConnections>["connectFrom"];
  /** Adds a node; with `groupId` an agent joins that group, if it may. */
  readonly add: PlanNodeInsertion["add"];
  readonly addScript: PlanNodeInsertion["addScript"];
  /** Adds a checked copy of a node template; an agent joins the group `groupId` if it may. */
  readonly insertTemplate: PlanNodeInsertion["insertTemplate"];
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
  /** Replaces one unresolved legacy frame endpoint with an explicitly chosen member. */
  readonly resolveGroupEdge: (
    groupId: string,
    edgeIndex: number,
    memberId: string,
  ) => void;
  readonly replaceStep: (step: AgentPlanStep) => void;
  readonly replaceNode: (node: AgentPlanNode) => void;
}

/**
 * The findings the canvas marks on nodes and ports.
 *
 * @remarks
 * A script is not at fault for being unable to run yet: the run panel names
 * that reason, the card is not marked as invalid for it.
 */
function canvasIssues(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): readonly AgentPlanIssue[] {
  return planExecutionIssues(draft, sources.agents).filter(
    (issue) => issue.reason !== "scriptUnavailable",
  );
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
  function resolveGroupEdge(
    groupId: string,
    edgeIndex: number,
    memberId: string,
  ): void {
    const group = draft.nodes.find((node) => node.id === groupId);
    if (
      group?.type !== "group" ||
      !group.steps.some((step) => step.id === memberId)
    )
      return;
    setDraft((previous) => ({
      ...previous,
      edges: previous.edges.map((edge, index) =>
        index !== edgeIndex
          ? edge
          : {
              ...edge,
              from: edge.from === groupId ? memberId : edge.from,
              to: edge.to === groupId ? memberId : edge.to,
            },
      ),
    }));
  }
  function replaceNode(node: AgentPlanNode): void {
    setDraft((previous) => replacePlanNode(previous, node));
  }
  return {
    issues: canvasIssues(draft, sources),
    ...selection,
    ...connections,
    ...insertion,
    ...groups,
    move,
    remove,
    disconnect,
    resolveGroupEdge,
    replaceStep: replaceNode,
    replaceNode,
  };
}
