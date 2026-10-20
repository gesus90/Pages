import { useState } from "react";

import { planStepTemplate } from "@/definition/AgentPlanConfiguration";
import { planGroupRefusal } from "@/definition/AgentPlanGroup";
import { placePlanStep } from "@/definition/AgentPlanGroupEdit";
import { placePlanLoopNode } from "@/definition/AgentPlanLoopEdit";

import { planMemberOrigin } from "./plan-layout";
import type { PlanFrame } from "./plan-layout";
import {
  createPlanNode,
  createPlanScript,
  planInsertPosition,
  snapPlanCoordinate,
} from "./plan-node-factory";

import type { Dispatch, SetStateAction } from "react";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";
import type { AgentPlanScriptConfiguration } from "@/definition/AgentPlanScript";
import type { PlanReferenceKind } from "./plan-node-factory";
import type {
  AgentPlanGroup,
  AgentPlanGroupRefusal,
} from "@/definition/AgentPlanGroup";

interface InsertionOptions {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly select: (id: string | null) => void;
  readonly loadConfiguration?: (id: string) => Promise<AgentPlanConfiguration>;
  /** Tells why a group refused a new agent; nothing was added then. */
  readonly onRefused?: (
    refusal: AgentPlanGroupRefusal,
    step: AgentPlanStep,
    group: AgentPlanGroup,
  ) => void;
}

/** Adding nodes of the palette and copies of saved node templates. */
export interface PlanNodeInsertion {
  readonly add: (
    kind: PlanReferenceKind,
    reference: string,
    position?: AgentPlanPosition,
    groupId?: string,
  ) => string | null;
  /** Adds a script with a checked configuration; it joins a loop, never a group. */
  readonly addScript: (
    configuration: AgentPlanScriptConfiguration,
    position?: AgentPlanPosition,
    loopId?: string,
  ) => string | null;
  readonly insertTemplate: (
    node: AgentPlanTemplateNode,
    position?: AgentPlanPosition,
    groupId?: string,
  ) => string | null;
  readonly insertionError: string | null;
}

/**
 * Fetches the template at insertion time, then gives the new node its own defaults.
 *
 * @remarks
 * A copy of a saved node template joins as it is, like a node of the
 * palette: in one draft change, into a frame only if the frame admits it.
 */
export function usePlanNodeInsertion(
  options: InsertionOptions,
): PlanNodeInsertion {
  const [insertionError, setInsertionError] = useState<string | null>(null);
  const { draft, sources, setDraft, select, loadConfiguration } = options;
  /** Whether the agent may join; a refusal is told and stops the insertion. */
  function admits(node: AgentPlanNode, group: PlanFrame | null): boolean {
    if (group?.type !== "group" || node.type !== "agent") return true;
    const refusal = planGroupRefusal(group, node, sources.agents);
    if (refusal === null) return true;
    options.onRefused?.(refusal, node, group);
    return false;
  }
  function insert(
    node: AgentPlanNode,
    group: PlanFrame | null,
    additions: readonly AgentPlanNode[] = nodeWithDefaults(
      node,
      draft,
      sources,
    ),
  ): string {
    setDraft((previous) => {
      if (previous.workspaceId !== draft.workspaceId) return previous;
      const added = { ...previous, nodes: [...previous.nodes, ...additions] };
      if (!group) return added;
      return joinFrame(added, { node, group }, sources) ?? previous;
    });
    select(node.id);
    return node.id;
  }
  async function insertCurrent(
    node: Extract<AgentPlanNode, { type: "agent" }>,
    group: PlanFrame | null,
  ): Promise<void> {
    if (!loadConfiguration) return;
    try {
      const configuration = await loadConfiguration(node.agentId);
      const current = { ...node, configuration };
      if (admits(current, group)) insert(current, group);
      setInsertionError(null);
    } catch (error: unknown) {
      console.error("Pages could not copy the current agent template.", error);
      setInsertionError("plan_sources_failed");
    }
  }
  function add(
    kind: PlanReferenceKind,
    reference: string,
    position?: AgentPlanPosition,
    groupId?: string,
  ): string | null {
    const node = createPlanNode({ draft, sources, kind, reference, position });
    const group = findFrame(draft, groupId);
    if (!node || !admits(node, group)) return null;
    if (node.type === "agent" && loadConfiguration) {
      void insertCurrent(node, group);
      return null;
    }
    return insert(node, group);
  }
  function insertTemplate(
    node: AgentPlanTemplateNode,
    position?: AgentPlanPosition,
    groupId?: string,
  ): string | null {
    if (!draft.workspaceId) return null;
    const at = position ?? planInsertPosition(draft);
    const placed = {
      ...node,
      x: snapPlanCoordinate(at.x),
      y: snapPlanCoordinate(at.y),
    };
    const group = findFrame(draft, groupId);
    if (!admits(placed, group)) return null;
    // The copy keeps its own configuration; no default value nodes join it.
    return insert(placed, group, [placed]);
  }
  function addScript(
    configuration: AgentPlanScriptConfiguration,
    position?: AgentPlanPosition,
    loopId?: string,
  ): string | null {
    const node = createPlanScript({ draft, configuration, position });
    const frame = findFrame(draft, loopId);
    return node
      ? insert(node, frame?.type === "loop" ? frame : null, [node])
      : null;
  }
  return { add, addScript, insertTemplate, insertionError };
}

/** The plan with the new node placed in its frame, or `null` when the frame refuses it. */
function joinFrame(
  plan: AgentPlanInput,
  target: { readonly node: AgentPlanNode; readonly group: PlanFrame },
  sources: AgentPlanSources,
): AgentPlanInput | null {
  const { node, group } = target;
  const position = memberOffset(group, node);
  if (group.type === "loop") {
    if (node.type !== "agent" && node.type !== "script") return plan;
    const joined = placePlanLoopNode(
      plan,
      { nodeId: node.id, loopId: group.id, position },
      { agents: sources.agents, detachFromGroup: (current) => current },
    );
    return typeof joined === "string" ? null : joined.plan;
  }
  const placed = placePlanStep(
    plan,
    { stepId: node.id, groupId: group.id, position },
    sources.agents,
  );
  return typeof placed === "string" ? null : placed.plan;
}

/** The frame, a group or a loop, a new node is meant to join, if it exists. */
function findFrame(
  draft: AgentPlanInput,
  frameId: string | undefined,
): PlanFrame | null {
  return (
    draft.nodes.find(
      (node): node is PlanFrame =>
        (node.type === "group" || node.type === "loop") && node.id === frameId,
    ) ?? null
  );
}

/** The position of a new member, counted from the member area of its frame. */
function memberOffset(
  group: PlanFrame,
  position: AgentPlanPosition,
): AgentPlanPosition {
  const origin = planMemberOrigin(group);
  return {
    x: snapPlanCoordinate(position.x - origin.x),
    y: snapPlanCoordinate(position.y - origin.y),
  };
}

/** Existing defaults become visible, individually connected value nodes. */
function nodeWithDefaults(
  node: AgentPlanNode,
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): readonly AgentPlanNode[] {
  if (node.type !== "agent") return [node];
  const configuration = planStepTemplate(node, sources.agents);
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
