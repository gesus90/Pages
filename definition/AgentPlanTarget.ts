import type { AgentPlanExecutionTarget } from "./AgentPlanExecution";
import type { AgentPlanInput, AgentPlanStep } from "./AgentPlan";
import type { AgentPlanScript } from "./AgentPlanScript";
import type { AgentPlanConfiguration } from "./AgentPlanConfiguration";
import type { ToolInventory } from "./RemoteSetup";

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
  | "remoteModel"
  | "remoteInterpreter"
  | "remoteContainer"
  | "remoteOffline"
  | "remoteIdentity"
  | "remoteCatalog"
  | "remoteWorkspace"
  | "remoteToolMissing"
  | "remoteLogin"
  | "remoteLoginUnknown"
  | "remoteOptions";

/** Secret-free, current runner facts for one registered workspace. */
export interface AgentPlanRemoteStatus {
  readonly workspaceId: string;
  readonly problem:
    "remoteOffline" | "remoteIdentity" | "remoteWorkspace" | null;
  readonly tools: readonly ToolInventory[];
  readonly hasModelCatalog: boolean;
  readonly interpreterIds?: readonly string[];
  readonly modelIds?: readonly string[];
  readonly catalogRevision?: string;
}

/** A node that its remote target cannot execute. */
export interface AgentPlanTargetIssue {
  readonly nodeId: string;
  readonly problem: AgentPlanTargetProblem;
}

function nodeTargetProblem(
  node: AgentPlanStep | AgentPlanScript,
  target: AgentPlanExecutionTarget,
  status?: AgentPlanRemoteStatus,
): AgentPlanTargetProblem | null {
  if (target.kind !== "remote") return null;
  if (status?.problem) return status.problem;
  if (node.type === "agent") return agentTargetProblem(node, target, status);
  if (
    status?.interpreterIds &&
    !status.interpreterIds.includes(node.interpreterProfileId)
  )
    return "remoteInterpreter";
  // A runner names its interpreters after the remote workspace they run in.
  return node.interpreterProfileId.startsWith(`${target.workspaceId}-`)
    ? null
    : "remoteInterpreter";
}

function agentTargetProblem(
  node: AgentPlanStep,
  target: Extract<AgentPlanExecutionTarget, { kind: "remote" }>,
  status?: AgentPlanRemoteStatus,
): AgentPlanTargetProblem | null {
  const configuration = node.configuration;
  if (!configuration) return "remoteModel";
  const route = configuration.runnerRoute;
  const isCli =
    configuration.provider === "codex_cli" ||
    configuration.provider === "claude_code";
  if (status && isCli) {
    const problem = cliTargetProblem(configuration, status);
    if (problem) return problem;
  }
  if (status && !isCli) {
    if (!status.hasModelCatalog) return "remoteCatalog";
    if (
      status.modelIds &&
      (!status.modelIds.includes(configuration.model) ||
        route?.catalogRevision !== status.catalogRevision)
    )
      return "remoteModel";
  }
  return route?.workspaceId === target.workspaceId ? null : "remoteModel";
}

function cliTargetProblem(
  configuration: AgentPlanConfiguration,
  status: AgentPlanRemoteStatus,
): AgentPlanTargetProblem | null {
  const tool = configuration.provider === "codex_cli" ? "codex" : "claude";
  const installed = status.tools.find((entry) => entry.tool === tool);
  if (!installed) return "remoteToolMissing";
  if (installed.authentication === "not_logged_in") return "remoteLogin";
  if (installed.authentication !== "authenticated") return "remoteLoginUnknown";
  const models = installed.models ?? [];
  if (!models.length) return "remoteCatalog";
  const route = configuration.runnerRoute;
  if (
    !models.some((model) => model.id === configuration.model) ||
    route?.catalogRevision !== installed.catalogRevision
  )
    return "remoteModel";
  const run = configuration.template.run;
  if (run && (run.access === "workspace_write" || run.browser))
    return "remoteOptions";
  return null;
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
  statuses?: readonly AgentPlanRemoteStatus[],
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
    const target = effectivePlanTarget(node, plan);
    const status =
      target.kind === "remote"
        ? statuses?.find((entry) => entry.workspaceId === target.workspaceId)
        : undefined;
    const problem = nodeTargetProblem(node, target, status);
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
