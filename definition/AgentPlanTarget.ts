import type { AgentPlanExecutionTarget } from "./AgentPlanExecution";
import type { AgentPlanInput, AgentPlanStep } from "./AgentPlan";
import type { AgentPlanScript } from "./AgentPlanScript";

/** Runs on the Pages host; a plan or node without a target has always meant this. */
export const LOCAL_PLAN_TARGET: AgentPlanExecutionTarget = { kind: "local" };

/**
 * A registered remote workspace that a plan may name as its execution target.
 *
 * @remarks
 * Only workspaces the person may see are listed; one they may see but not
 * run plans on is listed with the reason, so missing rights stay
 * understandable without disclosing anything hidden. No credential and no
 * SSH sign-in detail is part of it.
 */
export interface AgentPlanRemoteChoice {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** The name of the SSH connection, which identifies the host. */
  readonly connectionName: string;
  readonly projectId: string;
  /** The absolute directory on the remote machine. */
  readonly path: string;
  readonly isUsable: boolean;
  /**
   * Why plans cannot run there now: a reason of the remote workspace, or
   * `console_denied` without the right to run on its connection.
   */
  readonly reason: string | null;
}

/** Whether two targets name the same place; a missing target is the Pages host. */
export function isSamePlanTarget(
  first: AgentPlanExecutionTarget | undefined,
  second: AgentPlanExecutionTarget | undefined,
): boolean {
  const left = first ?? LOCAL_PLAN_TARGET;
  const right = second ?? LOCAL_PLAN_TARGET;
  if (left.kind === "local" || right.kind === "local")
    return left.kind === right.kind;
  return left.workspaceId === right.workspaceId;
}

/**
 * Where an agent or script node runs.
 *
 * @remarks
 * A node's own target is an explicit deviation and always wins; a node
 * without one inherits the plan's target, and a plan without one runs on the
 * Pages host, as plans did before plan targets existed.
 */
export function effectivePlanTarget(
  node: { readonly executionTarget?: AgentPlanExecutionTarget },
  plan: Pick<AgentPlanInput, "executionTarget">,
): AgentPlanExecutionTarget {
  return node.executionTarget ?? plan.executionTarget ?? LOCAL_PLAN_TARGET;
}

function inherited<Node extends AgentPlanStep | AgentPlanScript>(
  node: Node,
  target: AgentPlanExecutionTarget,
): Node {
  return node.executionTarget ? node : { ...node, executionTarget: target };
}

/**
 * The plan with its remote target written into every node that names none.
 *
 * @remarks
 * Execution reads targets from the nodes alone, so this is the one place
 * where inheritance turns into the target a run snapshot freezes. Group and
 * loop members inherit like any node. A local plan target changes nothing.
 */
export function withInheritedPlanTarget<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  const target = plan.executionTarget;
  if (target?.kind !== "remote") return plan;
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "agent" || node.type === "script")
        return inherited(node, target);
      if (node.type === "group")
        return {
          ...node,
          steps: node.steps.map((step) => inherited(step, target)),
        };
      if (node.type === "loop")
        return {
          ...node,
          steps: node.steps.map((step) => inherited(step, target)),
        };
      return node;
    }),
  };
}

/**
 * The agent and script nodes whose own target differs from a plan target.
 *
 * @remarks
 * Changing the plan target never rewrites them silently; the person decides
 * whether they keep their deviation or follow the plan.
 */
export function planTargetDeviations(
  plan: AgentPlanInput,
  target: AgentPlanExecutionTarget | undefined,
): readonly (AgentPlanStep | AgentPlanScript)[] {
  return plan.nodes
    .flatMap<AgentPlanStep | AgentPlanScript>((node) => {
      if (node.type === "group" || node.type === "loop") return node.steps;
      return node.type === "agent" || node.type === "script" ? [node] : [];
    })
    .filter(
      (node) =>
        node.executionTarget !== undefined &&
        !isSamePlanTarget(node.executionTarget, target),
    );
}

/**
 * The plan with the given nodes following the plan target again.
 *
 * @param plan - The plan to change.
 * @param nodeIds - The nodes that drop their own target.
 */
export function withPlanTargetFollowed<Plan extends AgentPlanInput>(
  plan: Plan,
  nodeIds: ReadonlySet<string>,
): Plan {
  function follow<Node extends AgentPlanStep | AgentPlanScript>(
    node: Node,
  ): Node {
    return nodeIds.has(node.id)
      ? { ...node, executionTarget: undefined }
      : node;
  }
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "agent" || node.type === "script") return follow(node);
      if (node.type === "group")
        return { ...node, steps: node.steps.map(follow) };
      if (node.type === "loop")
        return { ...node, steps: node.steps.map(follow) };
      return node;
    }),
  };
}

/** Why a node cannot run on the remote target it runs on. */
export type AgentPlanTargetProblem =
  "remoteModel" | "remoteInterpreter" | "remoteContainer";

/** A node that its remote target cannot execute. */
export interface AgentPlanTargetIssue {
  readonly nodeId: string;
  readonly problem: AgentPlanTargetProblem;
}

function nodeTargetProblem(
  node: AgentPlanStep | AgentPlanScript,
  target: AgentPlanExecutionTarget,
): AgentPlanTargetProblem | null {
  if (target.kind !== "remote") return null;
  if (node.type === "agent")
    return node.configuration?.runnerRoute?.workspaceId === target.workspaceId
      ? null
      : "remoteModel";
  // A runner names its interpreters after the remote workspace they run in.
  return node.interpreterProfileId.startsWith(`${target.workspaceId}-`)
    ? null
    : "remoteInterpreter";
}

/**
 * The nodes that cannot run on the remote target they name or inherit.
 *
 * @remarks
 * A remote target runs only models of its runner's catalog and the
 * runner's interpreters, and never members of groups or loops. Such a node
 * blocks the start; it is never moved to the Pages host instead.
 */
export function planTargetIssues(
  plan: AgentPlanInput,
): readonly AgentPlanTargetIssue[] {
  return plan.nodes.flatMap((node): AgentPlanTargetIssue[] => {
    if (node.type === "group" || node.type === "loop")
      return node.steps
        .filter((step) => effectivePlanTarget(step, plan).kind === "remote")
        .map((step): AgentPlanTargetIssue => ({
          nodeId: step.id,
          problem: "remoteContainer",
        }));
    if (node.type !== "agent" && node.type !== "script") return [];
    const problem = nodeTargetProblem(node, effectivePlanTarget(node, plan));
    return problem ? [{ nodeId: node.id, problem }] : [];
  });
}

/** Absolute paths of the Pages host, which a remote machine does not have as such. */
const LOCAL_PATH_PATTERN =
  /(?:^|[\s"'=:(`])((?:\/(?:home|Users|root|mnt|media|opt|srv)\/|~\/)[^\s"'`)]*)/gm;

/**
 * The absolute local paths a script names, at most three of them.
 *
 * @remarks
 * Pages never rewrites them for a remote target, and it cannot tell whether
 * the remote machine has them; the editor only points them out.
 */
export function scriptLocalPaths(
  script: Pick<AgentPlanScript, "content">,
): readonly string[] {
  const paths = new Set<string>();
  for (const match of script.content.matchAll(LOCAL_PATH_PATTERN)) {
    paths.add(match[1]);
    if (paths.size === 3) break;
  }
  return [...paths];
}
