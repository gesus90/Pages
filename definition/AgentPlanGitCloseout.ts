import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanPosition,
  AgentPlanStepRole,
} from "./AgentPlan";

/** The longest name of the node, as long as a script name. */
export const PLAN_GIT_CLOSEOUT_NAME_LENGTH = 120;
/** The longest check command in characters. */
export const PLAN_GIT_CLOSEOUT_COMMAND_LENGTH = 4000;
/** The input that names the ticket of the published commit. */
export const PLAN_GIT_CLOSEOUT_TICKET_INPUT = "ticket";
/** The output the following nodes read the structured result from. */
export const PLAN_GIT_CLOSEOUT_OUTPUT = "result";
/** The allowed run time in whole seconds, within the bounds of a script. */
export const PLAN_GIT_CLOSEOUT_TIMEOUT = {
  minimum: 60,
  maximum: 86_400,
  initial: 3600,
} as const;

/**
 * The fixed Git closeout of a plan: no model and no agent take part.
 *
 * @remarks
 * It checks the workspace, integrates the work on `origin/main` as one commit,
 * pushes it as a normal fast-forward and only then removes the local work
 * branch. The work branch is the name of the plan's workspace. It runs on the
 * Pages host with the process management of script nodes and therefore only at
 * the top level of a local plan.
 */
export interface AgentPlanGitCloseout extends AgentPlanPosition {
  readonly id: string;
  readonly type: "git_closeout";
  readonly name: string;
  /** Always a closeout: its failure leaves the finished work of the run intact. */
  readonly role: AgentPlanStepRole;
  /** The shell command that verifies a state a rebase changed, before it is pushed. */
  readonly checkCommand: string;
  readonly timeoutSeconds: number;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** Why a closeout stopped; the remote stayed unchanged unless `pushVerified` says otherwise. */
export type AgentPlanGitCloseoutReason =
  | "workspace_mismatch"
  | "remote_missing"
  | "remote_mismatch"
  | "remote_diverged"
  | "remote_unreachable"
  | "permission_denied"
  | "branch_mismatch"
  | "operation_in_progress"
  | "unrelated_history"
  | "commit_failed"
  | "rebase_conflict"
  | "secrets_detected"
  | "check_failed"
  | "check_dirtied"
  | "push_unverified"
  | "cleanup_failed";

/** The structured result a closeout hands on through its result port. */
export interface AgentPlanGitCloseoutResult {
  readonly status: "done" | "blocked";
  /** The published commit; `null` before a push and for `noOp`. */
  readonly commitSha: string | null;
  /** The `origin/main` the work was last integrated on. */
  readonly baseSha: string | null;
  /** The `main` the remote last reported. */
  readonly remoteMainSha: string | null;
  /** Only a fresh read of the remote that contains the commit sets this. */
  readonly pushVerified: boolean;
  /** There was nothing to publish, and no commit was created for it. */
  readonly noOp: boolean;
  readonly rebased: boolean;
  /** How often a moved `main` led to integrating the work again after a refused push. */
  readonly integrations: number;
  readonly checkRan: boolean;
  readonly workBranchDeleted: boolean;
  readonly reason?: AgentPlanGitCloseoutReason;
  readonly message?: string;
  /** The affected files of a conflict, a secret or a check that changed the tree. */
  readonly files?: readonly string[];
}

/** The configuration of a closeout without its place and connections. */
export type AgentPlanGitCloseoutConfiguration = Pick<
  AgentPlanGitCloseout,
  "name" | "checkCommand" | "timeoutSeconds"
>;

/** What is wrong with a closeout's own configuration. */
export type AgentPlanGitCloseoutIssue = "name" | "checkCommand" | "timeout";

/** The one input of the node: the ticket whose title and key name the commit. */
export const PLAN_GIT_CLOSEOUT_PARAMETERS: readonly AgentParameter[] = [
  {
    name: PLAN_GIT_CLOSEOUT_TICKET_INPUT,
    type: "ticket",
    description: "",
    isRequired: true,
    defaultValue: null,
  },
];

/**
 * Lists what a closeout needs before it can run.
 *
 * @remarks
 * A draft may lack the check command, as a script draft may lack its content:
 * saving works, Play is refused. Without a command nobody could verify the
 * state a rebase changed, so this is no optional setting.
 */
export function planGitCloseoutIssues(
  configuration: AgentPlanGitCloseoutConfiguration,
): readonly AgentPlanGitCloseoutIssue[] {
  const issues: AgentPlanGitCloseoutIssue[] = [];
  const name = configuration.name.trim();
  if (!name || name.length > PLAN_GIT_CLOSEOUT_NAME_LENGTH) issues.push("name");
  if (
    !configuration.checkCommand.trim() ||
    configuration.checkCommand.length > PLAN_GIT_CLOSEOUT_COMMAND_LENGTH
  )
    issues.push("checkCommand");
  const timeout = configuration.timeoutSeconds;
  if (
    !Number.isInteger(timeout) ||
    timeout < PLAN_GIT_CLOSEOUT_TIMEOUT.minimum ||
    timeout > PLAN_GIT_CLOSEOUT_TIMEOUT.maximum
  )
    issues.push("timeout");
  return issues;
}

/** A new node with the default time limit; it waits for its ticket and check command. */
export function emptyPlanGitCloseout(
  id: string,
  name: string,
  position: AgentPlanPosition,
): AgentPlanGitCloseout {
  return {
    ...position,
    id,
    type: "git_closeout",
    name,
    role: "closeout",
    checkCommand: "",
    timeoutSeconds: PLAN_GIT_CLOSEOUT_TIMEOUT.initial,
    bindings: {},
  };
}
