import { AgentPlanCloneGraph } from "./AgentPlanCloneGraph";

import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";

/** Explicit clone settings; omitted access fields retain normal creation defaults. */
export interface AgentPlanCloneInput {
  /** Only an active administrator can choose the copy's owner. */
  readonly ownerId?: string;
  readonly teams?: readonly AgentPlanTeam[];
  /** A newer source is copied automatically and named in the adjustment receipt. */
  readonly expectedRevision: number;
  readonly name: string;
  /** Defaults to the source workspace, then to the first usable workspace of its project. */
  readonly workspaceId?: string;
  /** Keeps an authorized source target when omitted; no workspace files are copied. */
  readonly executionTarget?: AgentPlanExecutionTarget;
  /** Marks only this copy as a one-time plan; it never inherits the source's mark. */
  readonly oneShot?: boolean;
}

/** Copies saved content and remaps every internal identity, with normal private creation sharing. */
export function clonePlanGraph(
  source: AgentPlanInput,
  input: AgentPlanCloneInput,
): AgentPlanInput {
  const plan = structuredClone(source);
  const target = input.executionTarget ?? plan.executionTarget;
  return {
    name: input.name,
    workspaceId: input.workspaceId ?? plan.workspaceId,
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
    ...(target?.kind === "remote" ? { executionTarget: target } : {}),
    ...(input.oneShot === true ? { oneShot: true } : {}),
    globals: plan.globals,
    ...new AgentPlanCloneGraph(plan).copy(),
  };
}
