import {
  copyPlanConfiguration,
  planConfigurationForModel,
} from "@/definition/AgentPlanConfiguration";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { PLAN_GRID } from "./plan-layout";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type {
  AgentPlanScript,
  AgentPlanScriptConfiguration,
} from "@/definition/AgentPlanScript";

/** The node types the palette adds by a reference; a script brings its whole configuration. */
export type PlanReferenceKind = Exclude<AgentPlanNode["type"], "script">;

// The plan page and the agent API remove nodes by the same rule.
export { removePlanNode } from "@/definition/AgentPlanGraph";

/** Coordinates remain bounded integral grid points even for edited numeric fields. */
export function snapPlanCoordinate(coordinate: number): number {
  if (!Number.isFinite(coordinate)) return 0;
  return Math.min(
    6000,
    Math.max(0, Math.round(coordinate / PLAN_GRID) * PLAN_GRID),
  );
}

/** Where a node added without a pointer goes: the next cell of a three-column grid. */
export function planInsertPosition(draft: AgentPlanInput): AgentPlanPosition {
  return {
    x: 40 + (draft.nodes.length % 3) * 320,
    y: 40 + Math.floor(draft.nodes.length / 3) * 340,
  };
}

/**
 * Creates a script node from a configuration the script dialog checked.
 *
 * @returns `null` before the plan has a workspace, whose working copy the
 * script would use.
 */
export function createPlanScript(input: {
  readonly draft: AgentPlanInput;
  readonly configuration: AgentPlanScriptConfiguration;
  readonly position?: AgentPlanPosition;
}): AgentPlanScript | null {
  if (!input.draft.workspaceId) return null;
  const position = input.position ?? planInsertPosition(input.draft);
  return {
    ...structuredClone(input.configuration),
    id: createRandomUuid(),
    type: "script",
    x: snapPlanCoordinate(position.x),
    y: snapPlanCoordinate(position.y),
    bindings: {},
  };
}

/** Creates an instance only from known source IDs, with an explicit default directory binding. */
export function createPlanNode(input: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly kind: PlanReferenceKind;
  readonly reference: string;
  readonly position?: AgentPlanPosition;
}): AgentPlanNode | null {
  const { draft, sources, kind, reference } = input;
  if (!draft.workspaceId) return null;
  const position = input.position ?? planInsertPosition(draft);
  const base = {
    id: createRandomUuid(),
    x: snapPlanCoordinate(position.x),
    y: snapPlanCoordinate(position.y),
  };
  if (kind === "start" || kind === "end") return { ...base, type: kind };
  if (kind === "loop") return emptyPlanLoop(base.id, reference, base);
  if (kind === "group")
    return {
      ...base,
      type: "group",
      name: reference,
      steps: [],
      edges: [],
      parameters: [],
      bindings: {},
    };
  if (kind === "agent") return planAgentNode(reference, sources, base);
  if (kind === "task")
    return sources.tasks.some((task) => task.id === reference)
      ? { ...base, type: "task", taskId: reference }
      : null;
  if (kind === "parameter")
    return {
      ...base,
      type: "parameter",
      name: reference,
      format: "string",
      value: { type: "text", text: "" },
    };
  return Object.hasOwn(draft.globals, reference)
    ? { ...base, type: "variable", name: reference }
    : null;
}

function planAgentNode(
  reference: string,
  sources: AgentPlanSources,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanNode | null {
  const model = sources.models?.find((entry) => entry.id === reference);
  if (model && (model.connectionId || model.runnerRoute))
    return {
      ...base,
      type: "agent",
      agentId: base.id,
      configuration: planConfigurationForModel(model),
      ...(model.runnerRoute
        ? {
            executionTarget: {
              kind: "remote" as const,
              workspaceId: model.runnerRoute.workspaceId,
            },
          }
        : {}),
      personalAgentId: null,
      instruction: "",
      bindings: {},
    };
  const agent = sources.agents.find(
    (entry) => entry.id === reference && entry.availability.isUsable,
  );
  if (!agent) return null;
  return {
    ...base,
    type: "agent",
    agentId: reference,
    configuration: copyPlanConfiguration(agent),
    personalAgentId: null,
    instruction: "",
    bindings: {},
  };
}
