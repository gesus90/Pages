import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  remoteModelCommand,
  withRemoteRunnerFeatures,
} from "./AgentPlanRemoteCommand";
import { remoteAcceptanceContract } from "./AgentPlanRemoteAcceptance";
import { validateRemoteParameterPrompt } from "./AgentPlanRemoteParameters";
import { requireRemoteResultPayload } from "./AgentPlanRemoteResolvedCommand";

import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RemotePlanParameters } from "./AgentPlanRemoteParameters";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

/** Builds the frozen remote command of an agent node after its model and inputs are checked. */
export async function prepareRemoteAgentCommand(options: {
  readonly userId: string;
  readonly plan: AgentPlan;
  readonly step: AgentPlanStep;
  readonly parameters: RemotePlanParameters | undefined;
  readonly target: AgentPlanRemoteTarget;
  readonly basis: Parameters<typeof remoteModelCommand>[1];
  readonly validateModel: (
    userId: string,
    plan: AgentPlan,
    step: AgentPlanStep,
  ) => Promise<void>;
  readonly tasks: Parameters<typeof remoteTodoChecklists>[0]["tasks"];
  readonly runners: Pick<
    RunnerService,
    | "supportsAgentAccounts"
    | "supportsBrowser"
    | "supportsProgress"
    | "supportsExactResultPayload"
  >;
  readonly canReceiveFiles: (
    target: AgentPlanRemoteTarget,
    parameters: RemotePlanParameters,
  ) => boolean;
}): Promise<{
  readonly command: RunnerExecution;
  readonly acceptanceContract: AgentPlanContract | undefined;
}> {
  const {
    userId,
    plan,
    step,
    parameters,
    target,
    basis,
    validateModel,
    tasks,
    runners,
    canReceiveFiles,
  } = options;
  await validateModel(userId, plan, step);
  const tickets = await remoteTodoChecklists({
    step,
    parameters,
    tasks,
    userId,
    projectId: plan.projectId,
  });
  const command = withRemoteRunnerFeatures(
    remoteModelCommand(step, basis, tickets),
    {
      accountId:
        step.configuration?.runnerRoute?.accountId ??
        (step.agentId || `${plan.id}:${step.id}`),
      hasAccounts: runners.supportsAgentAccounts(target.connectionId),
      hasBrowser: runners.supportsBrowser(target.connectionId),
      hasProgress: runners.supportsProgress(target.connectionId),
    },
  );
  const acceptanceContract = remoteAcceptanceContract(step, command, tickets);
  requireRemoteResultPayload(command, () =>
    runners.supportsExactResultPayload(target.connectionId),
  );
  if (
    parameters &&
    (command.program.kind === "cli" || command.program.kind === "model")
  )
    await validateRemoteParameterPrompt(
      step,
      parameters,
      command.program.prompt,
    );
  if (parameters?.assets.length && !canReceiveFiles(target, parameters))
    throw new AgentPlanValidationError([
      { nodeId: step.id, port: null, reason: "remoteAssetRunner" },
    ]);
  if (parameters?.resources.length && command.pagesAccess !== 1)
    throw new AgentError("plan_mcp_unavailable");
  return { command, acceptanceContract };
}

async function remoteTodoChecklists(input: {
  readonly step: AgentPlanStep;
  readonly parameters: RemotePlanParameters | undefined;
  readonly tasks: Pick<AgentPlanTasks, "checklist"> | undefined;
  readonly userId: string;
  readonly projectId: string;
}): Promise<readonly AgentPlanTicketChecklist[]> {
  const ids = Object.keys(input.parameters?.tickets ?? {});
  if (!ids.length) return [];
  const tasks = input.tasks;
  if (!tasks) throw new AgentError("plan_binding_invalid");
  return Promise.all(
    ids.map((id) => tasks.checklist(input.userId, input.projectId, id)),
  );
}
