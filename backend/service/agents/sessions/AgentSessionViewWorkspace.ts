import { checkRunBranch } from "@/definition/AgentPlanRunBranch";
import { LOCAL_RUNNER_CONNECTION_ID } from "@/backend/service/runner/LocalRunnerIdentity";

import { readSessionRunBranch } from "../AgentPlanRunBranchCapture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionView,
  AgentSessionWorkspace,
} from "@/definition/AgentSessionJournal";

interface ViewWorkspaceInput {
  readonly steps: readonly Pick<AgentPlanStepResult, "runBranch">[];
  readonly step: Pick<AgentPlanStepResult, "execution">;
  readonly record: AgentPlanSessionRecord;
  readonly stored: AgentSessionWorkspace | null;
}

/**
 * Uses the attempt's workspace snapshot and the branch its own run prepared.
 * A runner with no snapshot can show the stored target for a local path.
 */
export async function readViewWorkspace(
  input: ViewWorkspaceInput,
): Promise<Pick<AgentSessionView, "workspace" | "runBranch">> {
  const { step, record, stored } = input;
  const target = step.execution?.target;
  const isLocal =
    target?.kind !== "remote" ||
    target.connectionId === LOCAL_RUNNER_CONNECTION_ID;
  const directory =
    stored?.directory ??
    record.requested.directory ??
    step.execution?.workspace.path;
  if (!isLocal || !directory) {
    const actual = stored?.git;
    const runBranch = actual
      ? { expected: null, actual, check: checkRunBranch(null, actual) }
      : null;
    return { workspace: stored, runBranch };
  }
  const steps = input.steps.filter(
    ({ runBranch }) =>
      runBranch &&
      (record.startedAt === null || runBranch.recordedAt <= record.startedAt),
  );
  const runBranch = await readSessionRunBranch(
    steps,
    directory,
    async () => stored?.git ?? { state: "unreadable" },
  );
  return { workspace: stored, runBranch };
}
