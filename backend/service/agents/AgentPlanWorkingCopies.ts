import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import { isApiProvider } from "@/definition/AgentConnection";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";

import { hasPlanPath } from "./AgentPlanGraph";
import { planStepDirectory } from "./AgentPlanSnapshot";
import { overlapsWorkspacePath } from "./AgentWorkspacePath";
import {
  localWorkspaceEntry,
  workspaceConflict,
} from "./AgentPlanWorkspaceConflict";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";

function validateAgentWorkingCopies(
  plan: AgentPlan,
  steps: readonly AgentPlanStepSnapshot[],
): void {
  const localSteps = steps.filter((step) => !isApiProvider(step.provider));
  for (const first of localSteps) {
    for (const second of localSteps) {
      const firstDirectory = planStepDirectory(first);
      const secondDirectory = planStepDirectory(second);
      if (
        first.step.id === second.step.id ||
        (first.groupId !== undefined && first.groupId === second.groupId) ||
        (isReadOnly(first) && isReadOnly(second)) ||
        !firstDirectory ||
        !secondDirectory ||
        !sameWorkingCopy(firstDirectory, secondDirectory)
      )
        continue;
      if (
        !hasPlanPath(plan.edges, first.step.id, second.step.id) &&
        !hasPlanPath(plan.edges, second.step.id, first.step.id)
      )
        throw new AgentPlanWorkspaceConflictError(
          workspaceConflict("parallel_writers", [
            localWorkspaceEntry(firstDirectory, first.step.id, first.name),
            localWorkspaceEntry(secondDirectory, second.step.id, second.name),
          ]),
        );
    }
  }
}

/** Only the supported ACP read-only contract is treated as a reader. */
function isReadOnly(step: AgentPlanStepSnapshot): boolean {
  return (
    isAcpProvider(step.provider) &&
    agentRunOptionsFor(step.provider, step.template.run).access === "read_only"
  );
}

function sameWorkingCopy(
  first: ResolvedAgentWorkspace | null,
  second: ResolvedAgentWorkspace | null,
): boolean {
  return (
    first !== null &&
    second !== null &&
    (first.id === second.id ||
      first.directoryIdentity === second.directoryIdentity ||
      overlapsWorkspacePath(first.path, second.path))
  );
}

/** Direct scripts write in the resolved plan workspace and share the same ordering contract as agents. */
function validateScriptWorkingCopies(
  plan: AgentPlan,
  steps: readonly AgentPlanStepSnapshot[],
  scripts: readonly AgentPlanScriptSnapshot[],
): void {
  const writers = [
    ...scripts.map((script) => ({
      id: script.step.id,
      name: script.step.name,
      workspace: script.workspace,
    })),
    ...steps
      .filter((step) => !isApiProvider(step.provider))
      .map((step) => ({
        id: step.step.id,
        name: step.name,
        workspace: planStepDirectory(step),
      })),
  ];
  for (const script of scripts) {
    for (const other of writers) {
      if (
        script.step.id === other.id ||
        !other.workspace ||
        !sameWorkingCopy(script.workspace, other.workspace) ||
        hasPlanPath(plan.edges, script.step.id, other.id) ||
        hasPlanPath(plan.edges, other.id, script.step.id)
      )
        continue;
      throw new AgentPlanWorkspaceConflictError(
        workspaceConflict("parallel_writers", [
          localWorkspaceEntry(
            script.workspace,
            script.step.id,
            script.step.name,
          ),
          localWorkspaceEntry(other.workspace, other.id, other.name),
        ]),
      );
    }
  }
}

/** Rejects unordered writes on the same resolved local working copy before dispatch. */
export function validatePlanWorkingCopies(
  plan: AgentPlan,
  steps: readonly AgentPlanStepSnapshot[],
  scripts: readonly AgentPlanScriptSnapshot[],
): void {
  validateAgentWorkingCopies(plan, steps);
  validateScriptWorkingCopies(plan, steps, scripts);
}
