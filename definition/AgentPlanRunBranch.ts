import { z } from "zod";

import type { AgentPlanStepResult } from "./AgentPlan";
import type { AgentSessionGitState } from "./AgentSessionJournal";

/** The line a preparation script prints to name the branch it set up. */
export const RUN_BRANCH_DECLARATION = "PAGES_RUN_BRANCH=";
/** Longest branch name a run keeps; Git allows longer, Pages never needs it. */
const BRANCH_LENGTH = 255;
const BRANCH_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/@+-]+(?<![./])$/u;

const gitStateSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("branch"),
      branch: z.string().min(1).max(BRANCH_LENGTH),
    })
    .strict(),
  z
    .object({ state: z.literal("detached"), commit: z.string().min(1).max(64) })
    .strict(),
  z.object({ state: z.literal("no_repository") }).strict(),
  z.object({ state: z.literal("unreadable") }).strict(),
]);

/** Validates a persisted run branch; a damaged value makes the stored step unreadable. */
export const planRunBranchSchema = z
  .object({
    workspaceId: z.string().min(1).max(200),
    workspaceName: z.string().max(200).nullable(),
    directory: z.string().min(1).max(4_096),
    branch: z.string().min(1).max(BRANCH_LENGTH),
    declared: z.string().min(1).max(BRANCH_LENGTH).nullable(),
    observed: gitStateSchema,
    state: z.enum(["confirmed", "mismatch"]),
    stepId: z.string().min(1).max(200),
    recordedAt: z.string().min(1).max(64),
  })
  .strict();

/**
 * The branch a preparation step of the run set up in one workspace.
 * @remarks
 * It belongs to the step result of that preparation, so it is stored with
 * the run and never shared with another run or held in process memory.
 * `branch` is the target the later nodes work on: the declared name when
 * the preparation printed one, otherwise the branch Pages observed after it.
 * `state` is `mismatch` when the declaration and the Git state Pages read
 * after the preparation differ; the target stays the declared name.
 */
export type AgentPlanRunBranch = z.infer<typeof planRunBranchSchema>;

/** Where the current Git state of a workspace stands against its run branch. */
export type AgentPlanRunBranchCheck =
  | "missing"
  | "matches"
  | "differs"
  | "detached"
  | "no_repository"
  | "unreadable";

/** The run branch of a session's workspace, compared with the Git state read now. */
export interface AgentSessionRunBranch {
  /** The stored target, or `null` when no preparation of the run set one up. */
  readonly expected: AgentPlanRunBranch | null;
  /** The Git state Pages read from the repository files for this view. */
  readonly actual: AgentSessionGitState;
  readonly check: AgentPlanRunBranchCheck;
}

/** Whether a text is a branch name Pages accepts from a preparation. */
export function isRunBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= BRANCH_LENGTH &&
    !name.endsWith(".lock") &&
    BRANCH_NAME.test(name)
  );
}

/**
 * Reads the branch a preparation declared in its output.
 * @returns The last declared name; `null` without a declaration or for an
 * invalid name, which is never shortened or repaired.
 */
export function declaredRunBranch(output: string | null): string | null {
  if (output === null) return null;
  let declared: string | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(RUN_BRANCH_DECLARATION)) continue;
    const name = trimmed.slice(RUN_BRANCH_DECLARATION.length).trim();
    declared = isRunBranchName(name) ? name : null;
  }
  return declared;
}

/** What a finished preparation left behind in one workspace. */
export interface RunBranchObservation {
  readonly workspace: {
    readonly id: string;
    readonly name: string | null;
    readonly directory: string;
  };
  readonly stepId: string;
  readonly output: string | null;
  readonly before: AgentSessionGitState;
  readonly after: AgentSessionGitState;
  readonly recordedAt: string;
}

function isSameGitState(
  first: AgentSessionGitState,
  second: AgentSessionGitState,
): boolean {
  if (first.state === "branch" && second.state === "branch")
    return first.branch === second.branch;
  if (first.state === "detached" && second.state === "detached")
    return first.commit === second.commit;
  return first.state === second.state;
}

/**
 * Decides whether a successful script set up the run branch of its workspace.
 * @remarks
 * A script sets it up when it declares a branch in its output or when the
 * branch of the workspace changed while it ran. Any other script leaves the
 * run branch as it was.
 * @returns The run branch to store, or `null` when the script set up none.
 */
export function recordRunBranch(
  observation: RunBranchObservation,
): AgentPlanRunBranch | null {
  const declared = declaredRunBranch(observation.output);
  const { after } = observation;
  const hasChanged =
    after.state === "branch" && !isSameGitState(observation.before, after);
  if (declared === null && !hasChanged) return null;
  const observedBranch = after.state === "branch" ? after.branch : null;
  const branch = declared ?? observedBranch;
  if (branch === null) return null;
  return {
    workspaceId: observation.workspace.id,
    workspaceName: observation.workspace.name,
    directory: observation.workspace.directory,
    branch,
    declared,
    observed: after,
    state: branch === observedBranch ? "confirmed" : "mismatch",
    stepId: observation.stepId,
    recordedAt: observation.recordedAt,
  };
}

function isInsideDirectory(root: string, target: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(normalizedRoot);
}

/**
 * The run branch of the workspace that contains a directory.
 * @remarks
 * Every workspace keeps its own value: the deepest workspace that contains the
 * directory wins and, within it, the latest recorded preparation. A run branch
 * of another workspace is never used as a fallback.
 * @param steps - The step results of one run.
 * @param directory - The real path of the session's working directory.
 */
export function runBranchFor(
  steps: readonly Pick<AgentPlanStepResult, "runBranch">[],
  directory: string,
): AgentPlanRunBranch | null {
  let selected: AgentPlanRunBranch | null = null;
  for (const step of steps) {
    const candidate = step.runBranch;
    if (!candidate || !isInsideDirectory(candidate.directory, directory))
      continue;
    if (
      selected === null ||
      candidate.directory.length > selected.directory.length ||
      (candidate.directory.length === selected.directory.length &&
        candidate.recordedAt > selected.recordedAt)
    )
      selected = candidate;
  }
  return selected;
}

/** Every workspace's current run branch, one per workspace directory. */
export function runBranches(
  steps: readonly Pick<AgentPlanStepResult, "runBranch">[],
): readonly AgentPlanRunBranch[] {
  const latest = new Map<string, AgentPlanRunBranch>();
  for (const step of steps) {
    const candidate = step.runBranch;
    if (!candidate) continue;
    const known = latest.get(candidate.directory);
    if (!known || candidate.recordedAt > known.recordedAt)
      latest.set(candidate.directory, candidate);
  }
  return [...latest.values()];
}

/**
 * Compares the stored run branch with the Git state read now.
 * @remarks
 * The comparison only reads; it never checks a branch out.
 */
export function checkRunBranch(
  expected: AgentPlanRunBranch | null,
  actual: AgentSessionGitState,
): AgentPlanRunBranchCheck {
  if (actual.state === "no_repository") return "no_repository";
  if (actual.state === "unreadable") return "unreadable";
  if (expected === null) return "missing";
  if (actual.state === "detached") return "detached";
  return actual.branch === expected.branch ? "matches" : "differs";
}
