import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { LOCAL_RUNNER_CONNECTION_ID } from "@/backend/service/runner/LocalRunnerIdentity";

import { readSessionRunBranch } from "../AgentPlanRunBranchCapture";
import { checkSessionWorkspace } from "./AgentSessionWorkspace";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionView,
  AgentSessionWorkspace,
} from "@/definition/AgentSessionJournal";

interface ViewWorkspaceInput {
  /** The step results of the session's own, already authorized run. */
  readonly steps: readonly Pick<AgentPlanStepResult, "runBranch">[];
  /** The session's own step; its execution target tells on which host its files lie. */
  readonly step: Pick<AgentPlanStepResult, "execution">;
  readonly record: AgentPlanSessionRecord;
  /** The workspace the session journal checked, if it recorded one. */
  readonly stored: AgentSessionWorkspace | null;
  readonly checkedAt: string;
}

/** The directory the plan assigned to a node and the workspace root it must stay inside. */
interface AssignedWorkspace {
  readonly directory: string;
  readonly workspace: string;
}

/**
 * The directory the plan assigned to a Claude Code node without a recorded workspace.
 * @returns `null` for another provider and for a node on another host, whose
 * files Pages cannot read here; a local path of the same name would name
 * another machine's state.
 */
function assignedWorkspace(
  input: ViewWorkspaceInput,
): AssignedWorkspace | null {
  const { directory } = input.record.requested;
  if (input.record.runner !== "claude_code" || directory === null) return null;
  const target = input.step.execution?.target;
  if (target?.kind !== "remote") return { directory, workspace: directory };
  if (target.connectionId !== LOCAL_RUNNER_CONNECTION_ID) return null;
  return { directory, workspace: target.path };
}

async function checkAssigned(
  assignment: AssignedWorkspace,
  checkedAt: string,
): Promise<AgentSessionWorkspace | null> {
  try {
    return await checkSessionWorkspace(assignment, checkedAt);
  } catch (error: unknown) {
    // A directory that is gone or outside its workspace shows no workspace; its run branch still shows.
    if (!(error instanceof AgentError))
      logCaughtError("AgentSessionView", error);
    return null;
  }
}

/**
 * The workspace and run branch a session view shows.
 * @remarks
 * The workspace the session journal checked comes first. A Claude Code
 * session of a runner records none, so the view checks the directory the plan
 * assigned to the node, the same one its assignment named, when it lies on
 * this host (a local node or the local runner); no path comes from the CLI.
 * The run branch is the stored value of exactly that workspace in the
 * session's own run, so missing session metadata never hides a known target.
 * The current Git state is read apart from it, and reading never checks a
 * branch out.
 */
export async function readViewWorkspace(
  input: ViewWorkspaceInput,
): Promise<Pick<AgentSessionView, "workspace" | "runBranch">> {
  if (input.stored !== null)
    return {
      workspace: input.stored,
      runBranch: await readSessionRunBranch(
        input.steps,
        input.stored.directory,
      ),
    };
  const assignment = assignedWorkspace(input);
  if (assignment === null) return { workspace: null, runBranch: null };
  return {
    workspace: await checkAssigned(assignment, input.checkedAt),
    runBranch: await readSessionRunBranch(input.steps, assignment.directory),
  };
}
