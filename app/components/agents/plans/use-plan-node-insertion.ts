import { useState } from "react";

import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import { createPlanNode } from "./plan-node-factory";

import type { Dispatch, SetStateAction } from "react";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

interface InsertionOptions {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly select: (id: string | null) => void;
  readonly loadConfiguration?: (id: string) => Promise<AgentPlanConfiguration>;
}

/** Fetches the template at insertion time, then gives the new node its own defaults. */
export function usePlanNodeInsertion(options: InsertionOptions): {
  readonly add: (
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ) => string | null;
  readonly insertionError: string | null;
} {
  const [insertionError, setInsertionError] = useState<string | null>(null);
  const { draft, sources, setDraft, select, loadConfiguration } = options;
  function insert(node: AgentPlanNode): string {
    const additions = nodeWithDefaults(node, draft, sources);
    setDraft((previous) =>
      previous.workspaceId === draft.workspaceId
        ? { ...previous, nodes: [...previous.nodes, ...additions] }
        : previous,
    );
    select(node.id);
    return node.id;
  }
  async function insertCurrent(
    node: Extract<AgentPlanNode, { type: "agent" }>,
  ): Promise<void> {
    if (!loadConfiguration) return;
    try {
      const configuration = await loadConfiguration(node.agentId);
      insert({ ...node, configuration });
      setInsertionError(null);
    } catch (error: unknown) {
      console.error("Pages could not copy the current agent template.", error);
      setInsertionError("plan_sources_failed");
    }
  }
  function add(
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ): string | null {
    const node = createPlanNode({ draft, sources, kind, reference, position });
    if (!node) return null;
    if (node.type === "agent" && loadConfiguration) {
      void insertCurrent(node);
      return null;
    }
    return insert(node);
  }
  return { add, insertionError };
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
