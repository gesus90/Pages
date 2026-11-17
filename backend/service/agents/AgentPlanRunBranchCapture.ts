import { realpath } from "node:fs/promises";

import {
  checkRunBranch,
  recordRunBranch,
  runBranchFor,
} from "@/definition/AgentPlanRunBranch";
import { logCaughtError } from "@/backend/logging/Logger";
import { isMissingPath } from "./AgentCanonicalPath";

import { readWorkspaceGit } from "./sessions/AgentSessionWorkspace";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionRunBranch } from "@/definition/AgentPlanRunBranch";
import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Reads the Git state of a directory; tests replace it. */
export type RunBranchGitReader = (
  directory: string,
) => Promise<AgentSessionGitState>;

/** The Git state Pages read in a script's workspace before it started. */
export interface RunBranchBaseline {
  readonly directory: string;
  readonly before: AgentSessionGitState;
}

async function realDirectory(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error: unknown) {
    // A directory of a remote workspace does not exist here; the Git reader reports it as no repository.
    if (!isMissingPath(error))
      logCaughtError("AgentPlanRunBranchCapture", error);
    return directory;
  }
}

/** Whether Pages can read the script's workspace on this host. */
function isLocalScript(
  snapshot: AgentPlanSnapshot,
  script: AgentPlanScriptSnapshot,
): boolean {
  if (script.step.executionTarget?.kind === "remote") return false;
  return !snapshot.remoteSteps?.some(
    (entry) => entry.step.id === script.step.id,
  );
}

/**
 * Reads the Git state of a local script's workspace before it runs.
 * @returns `null` for a script on a remote target, whose files Pages cannot read here.
 */
export async function readRunBranchBaseline(
  snapshot: AgentPlanSnapshot,
  script: AgentPlanScriptSnapshot,
  readGit: RunBranchGitReader = readWorkspaceGit,
): Promise<RunBranchBaseline | null> {
  if (!isLocalScript(snapshot, script)) return null;
  const directory = await realDirectory(script.workspace.path);
  return { directory, before: await readGit(directory) };
}

/**
 * Adds the run branch a successful preparation set up to its step result.
 * @remarks
 * Only the stored output and the Git state of the script's own workspace
 * count; a result without a baseline, a failed script and a script that set
 * up no branch stay unchanged.
 */
export async function withRunBranch(
  result: Partial<AgentPlanStepResult>,
  context: {
    readonly baseline: RunBranchBaseline | null;
    readonly script: AgentPlanScriptSnapshot;
    readonly recordedAt: string;
    readonly readGit?: RunBranchGitReader;
  },
): Promise<Partial<AgentPlanStepResult>> {
  const { baseline, script } = context;
  if (baseline === null || result.status !== "succeeded" || result.skipped)
    return result;
  const readGit = context.readGit ?? readWorkspaceGit;
  const runBranch = recordRunBranch({
    workspace: {
      id: script.workspace.id,
      name: script.workspace.name ?? null,
      directory: baseline.directory,
    },
    stepId: script.step.id,
    output: result.script?.stdout ?? result.output ?? null,
    before: baseline.before,
    after: await readGit(baseline.directory),
    recordedAt: context.recordedAt,
  });
  return runBranch === null ? result : { ...result, runBranch };
}

/**
 * Compares the stored run branch of a session's workspace with its Git state now.
 * @remarks
 * Called when a session starts or continues and when its view is read; it
 * reads `HEAD` only and never checks a branch out.
 * @param steps - The step results of the session's own run.
 * @param directory - The working directory of the session.
 */
export async function readSessionRunBranch(
  steps: readonly Pick<AgentPlanStepResult, "runBranch">[],
  directory: string,
  readGit: RunBranchGitReader = readWorkspaceGit,
): Promise<AgentSessionRunBranch> {
  const real = await realDirectory(directory);
  const expected = runBranchFor(steps, real);
  const actual = await readGit(real);
  return { expected, actual, check: checkRunBranch(expected, actual) };
}
