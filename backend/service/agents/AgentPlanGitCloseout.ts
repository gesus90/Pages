import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  PLAN_GIT_CLOSEOUT_OUTPUT,
  PLAN_GIT_CLOSEOUT_TICKET_INPUT,
} from "@/definition/AgentPlanGitCloseout";

import { PLAN_GIT_CLOSEOUT_SOURCE } from "./AgentPlanGitCloseoutSource";
import { planStackTicketId } from "./stack/AgentPlanStackInputs";

import type { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type {
  AgentPlan,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanGitCloseout,
  AgentPlanGitCloseoutReason,
} from "@/definition/AgentPlanGitCloseout";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { InterpreterProfile } from "@/definition/InterpreterProfile";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanGitHubCredentials } from "./AgentPlanGitHubCredentials";
import type {
  AgentPlanGitCloseoutRun,
  AgentPlanScriptSnapshot,
} from "./AgentPlanScriptPreparation";
import type { AgentPlanTasks } from "./AgentPlanTasks";

const execFileAsync = promisify(execFile);

/** No profile can have this identifier: their identifiers are checked where they are configured. */
const PAGES_INTERPRETER_ID = "pages-git-closeout";
const IDENTITY_TIMEOUT_MILLISECONDS = 5000;

const REASON_ERRORS: Readonly<
  Record<AgentPlanGitCloseoutReason, AgentErrorCode>
> = {
  workspace_mismatch: "plan_git_closeout_state",
  remote_missing: "plan_git_closeout_remote",
  remote_mismatch: "plan_git_closeout_remote",
  remote_diverged: "plan_git_closeout_remote",
  remote_unreachable: "plan_git_closeout_unreachable",
  permission_denied: "plan_git_closeout_permission",
  branch_mismatch: "plan_git_closeout_state",
  operation_in_progress: "plan_git_closeout_state",
  unrelated_history: "plan_git_closeout_state",
  commit_failed: "plan_git_closeout_state",
  rebase_conflict: "plan_git_closeout_conflict",
  secrets_detected: "plan_git_closeout_secrets",
  check_failed: "plan_git_closeout_check",
  check_dirtied: "plan_git_closeout_check",
  push_unverified: "plan_git_closeout_unverified",
  cleanup_failed: "plan_git_closeout_cleanup",
};

/** What one start of a closeout hands to its process, and what ends with it. */
export interface AgentPlanGitCloseoutAccess {
  readonly input: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly redact: (text: string) => string;
  readonly recordNamespace: (owner: AcpNamespaceOwner) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

/** Whether a frozen interpreter is the Node.js of this server rather than a configured profile. */
export function isPagesInterpreter(interpreter: InterpreterProfile): boolean {
  return interpreter.id === PAGES_INTERPRETER_ID;
}

/** The ticket a closeout's input names outside a stack; `null` when it comes from a stack. */
function boundTicketId(
  plan: AgentPlan,
  node: AgentPlanGitCloseout,
): string | null {
  const binding = node.bindings[PLAN_GIT_CLOSEOUT_TICKET_INPUT];
  if (binding?.kind === "stack") return null;
  if (binding?.kind === "literal" && binding.value?.type === "ticket")
    return binding.value.ticketId;
  if (binding?.kind === "source") {
    const source = plan.nodes.find((entry) => entry.id === binding.nodeId);
    if (source?.type === "task") return source.taskId;
    if (source?.type === "parameter" && source.value.type === "ticket")
      return source.value.ticketId;
  }
  throw new AgentError("plan_binding_invalid");
}

/**
 * Freezes a closeout as a script of the existing runtime.
 *
 * @remarks
 * Attempt records, the time limit, the process boundary, stop and recovery work
 * on this script like on any other. The program comes from Pages, not from the
 * plan, and its only output is the structured result.
 *
 * @throws {AgentError} `workspace_project_unsupported` without a named GitHub
 * link of the project or without the name of the workspace.
 */
export function gitCloseoutSnapshot(
  plan: AgentPlan,
  node: AgentPlanGitCloseout,
  workspace: ResolvedAgentWorkspace,
): AgentPlanScriptSnapshot {
  const repository = workspace.github?.repoName;
  if (!repository || !workspace.name)
    throw new AgentError("workspace_project_unsupported");
  const ticketId = boundTicketId(plan, node);
  return {
    step: {
      id: node.id,
      x: node.x,
      y: node.y,
      type: "script",
      name: node.name,
      role: node.role,
      interpreterProfileId: PAGES_INTERPRETER_ID,
      content: PLAN_GIT_CLOSEOUT_SOURCE,
      inputs: [],
      outputs: [{ name: PLAN_GIT_CLOSEOUT_OUTPUT, type: "text" }],
      timeoutSeconds: node.timeoutSeconds,
      bindings: {},
    },
    interpreter: {
      id: PAGES_INTERPRETER_ID,
      name: "Node.js",
      path: process.execPath,
    },
    workspace,
    inputs: {},
    taskIds: ticketId === null ? [] : [ticketId],
    gitCloseout: {
      node,
      workBranch: workspace.name,
      repository,
    },
  };
}

function isReason(value: unknown): value is AgentPlanGitCloseoutReason {
  return typeof value === "string" && Object.hasOwn(REASON_ERRORS, value);
}

/**
 * Turns the process result of a closeout into the result of its step.
 *
 * @remarks
 * A stop keeps its structured result as the output, so the files of a conflict
 * stay readable beside the error. A process that ended without one, through its
 * time limit or a stop, keeps the cause the script runtime names.
 */
export function assessGitCloseoutResult(
  result: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  let value: unknown;
  try {
    value = JSON.parse(result.script?.stdout ?? "");
  } catch {
    return result.status === "succeeded"
      ? {
          ...result,
          status: "failed",
          error: "plan_git_closeout_result_invalid",
        }
      : result;
  }
  if (typeof value !== "object" || value === null || !("status" in value))
    return {
      ...result,
      status: "failed",
      error: "plan_git_closeout_result_invalid",
    };
  // A later failure of the process boundary, such as an unconfirmed cleanup, keeps its own cause.
  if (result.status === "succeeded" && value.status === "done") return result;
  if (
    value.status !== "blocked" ||
    !("reason" in value) ||
    !isReason(value.reason)
  )
    return result;
  return {
    ...result,
    status: "failed",
    output: result.script?.stdout ?? null,
    error: REASON_ERRORS[value.reason],
  };
}

/** Resolves what the fixed closeout may use when it starts: the ticket, the identity and the Git route. */
export class AgentPlanGitCloseoutRuntime {
  private readonly dependencies: {
    readonly tasks: Pick<AgentPlanTasks, "checklist">;
    readonly github: Pick<
      AgentPlanGitHubCredentials,
      "resolve" | "resolveBridge"
    >;
    readonly credentials: Pick<CliGitHubCredentials, "prepare">;
    readonly locator: Pick<CliLocator, "locate">;
  };

  public constructor(
    dependencies: AgentPlanGitCloseoutRuntime["dependencies"],
  ) {
    this.dependencies = dependencies;
  }

  /**
   * Opens the Git route of one start, the same one an agent of the project gets.
   *
   * @remarks
   * Nothing here changes `origin` or a stored credential, and the token stays a
   * file of the private folder that the credential helper reads. An executor
   * who may not write to the project gets no token, so that Git's refusal stops
   * the closeout. The check command runs without this environment.
   */
  public async open(request: {
    readonly run: AgentPlanRun;
    readonly plan: AgentPlan;
    readonly closeout: AgentPlanGitCloseoutRun;
    readonly workspace: ResolvedAgentWorkspace;
    readonly instanceId: string;
  }): Promise<AgentPlanGitCloseoutAccess> {
    const { run, plan, closeout, workspace, instanceId } = request;
    const ticket = await this.dependencies.tasks.checklist(
      run.userId,
      plan.projectId,
      boundTicketId(plan, closeout.node) ??
        planStackTicketId(stackBinding(closeout.node), { plan, run }),
    );
    const identity = await readIdentity(workspace.path);
    const access = await this.dependencies.github.resolve(
      run.userId,
      workspace,
    );
    const bridge = await this.dependencies.github.resolveBridge(
      run.userId,
      workspace,
      { planId: plan.id, stepId: closeout.node.id },
    );
    const gh =
      access.status === "available"
        ? (await this.dependencies.locator.locate("gh")).path
        : null;
    const prepared = await this.dependencies.credentials.prepare({
      instanceId,
      access,
      gh,
      bridge,
      searchPath: [
        path.dirname(process.execPath),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(path.delimiter),
    });
    return {
      input: JSON.stringify({
        workBranch: closeout.workBranch,
        repository: closeout.repository,
        checkCommand: closeout.node.checkCommand,
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
      }),
      environment: { ...prepared.environment, ...identity },
      redact: prepared.redact,
      recordNamespace: prepared.recordNamespace,
      cleanup: prepared.cleanup,
    };
  }
}

function stackBinding(
  node: AgentPlanGitCloseout,
): Extract<AgentPlanGitCloseout["bindings"][string], { kind: "stack" }> {
  const binding = node.bindings[PLAN_GIT_CLOSEOUT_TICKET_INPUT];
  if (binding?.kind !== "stack") throw new AgentError("plan_binding_invalid");
  return binding;
}

async function readGitSetting(
  directory: string,
  name: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", name], {
      cwd: directory,
      timeout: IDENTITY_TIMEOUT_MILLISECONDS,
    });
    return stdout.trim() || null;
  } catch {
    // Git answers with an exit code when the setting does not exist.
    return null;
  }
}

/**
 * The identity a person working in this copy commits with.
 *
 * @remarks
 * Read here, because the closeout has neither the account's home nor its global
 * configuration. Without one, the commit fails and names the Git identity.
 */
async function readIdentity(
  directory: string,
): Promise<Readonly<Record<string, string>>> {
  const name = await readGitSetting(directory, "user.name");
  const email = await readGitSetting(directory, "user.email");
  if (name === null || email === null) return {};
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}
