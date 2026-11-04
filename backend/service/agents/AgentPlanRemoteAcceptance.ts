import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { RUNNER_TOOL_PROVIDERS } from "@/definition/RunnerExecution";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";

import { planStepOutput } from "./AgentPlanAcceptance";
import { planSessionReach } from "./AgentPlanSessionAccess";
import { AgentPlanStepAssessment } from "./AgentPlanStepAssessment";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { AgentPlanTasks } from "./AgentPlanTasks";

/** Whether this frozen command requires the same business gate as local OpenCode. */
export function requiresRemoteAcceptance(remote: RemotePlanStep): boolean {
  return remote.step.type === "agent" && remote.command.program.kind === "cli";
}

/** The instruction, provider and reach a remote CLI agent is assessed under; `null` for anything else. */
function remoteAgentTerms(remote: RemotePlanStep):
  | (Omit<AgentPlanSessionTerms, "contract"> & {
      readonly provider: AgentProviderId;
    })
  | null {
  if (remote.step.type !== "agent" || !remote.step.configuration) return null;
  const program = remote.command.program;
  if (program.kind !== "cli" || !program.route.tool) return null;
  const provider = RUNNER_TOOL_PROVIDERS[program.route.tool];
  return {
    instruction: remote.step.instruction,
    provider,
    reach: planSessionReach(
      provider,
      agentRunOptionsFor(provider, remote.step.configuration.template.run),
    ),
  };
}

/**
 * What a remote agent's report is assessed against.
 *
 * @param remote - The frozen step.
 * @returns Contract, instruction, reach and provider; `null` when the frozen command holds no contract or is no CLI agent.
 */
export function remoteAssessmentTerms(
  remote: RemotePlanStep,
): (AgentPlanSessionTerms & { readonly provider: AgentProviderId }) | null {
  const terms = remoteAgentTerms(remote);
  const contract = readPlanContract(remote.acceptanceContract);
  return terms && contract ? { ...terms, contract } : null;
}

/** Marks an unassessable result failed without inventing a report or changing process evidence. */
function assessmentFailed(
  result: Partial<AgentPlanStepResult>,
  error:
    | "plan_acceptance_unavailable"
    | "plan_acceptance_contract_unavailable" = "plan_acceptance_unavailable",
): Partial<AgentPlanStepResult> {
  return {
    ...result,
    status: "failed",
    error,
    ...(result.session
      ? { session: { ...result.session, resultCode: -1, acceptance: null } }
      : {}),
  };
}

interface AcceptanceInput {
  readonly remote: RemotePlanStep;
  readonly run: AgentPlanRun;
  readonly result: Partial<AgentPlanStepResult>;
  readonly tasks: Pick<AgentPlanTasks, "checklist"> | undefined;
  readonly projectId: () => Promise<string>;
  /** What the agent reported through the tool; without it the final answer decides. */
  readonly stepReport?: AgentPlanStepReport | null;
}

/** Checks the pinned report against the executor's current ticket state after confirmed closeout. */
export async function settleRemoteAcceptance(
  input: AcceptanceInput,
): Promise<Partial<AgentPlanStepResult>> {
  const { remote, run, result, tasks } = input;
  if (!requiresRemoteAcceptance(remote) || result.status !== "succeeded")
    return result;
  const session = result.session;
  if (!tasks || !session?.contract || result.remote?.closeout !== "confirmed")
    return assessmentFailed(result);
  return assessRemoteReport({ ...input, run, tasks, session });
}

async function assessRemoteReport(
  input: AcceptanceInput & {
    readonly tasks: Pick<AgentPlanTasks, "checklist">;
    readonly session: AgentPlanSessionRecord;
  },
): Promise<Partial<AgentPlanStepResult>> {
  const { remote, run, result, tasks, session } = input;
  if (remote.step.type !== "agent" || !remote.step.configuration)
    return assessmentFailed(result);
  try {
    const contract = readPlanContract(remote.acceptanceContract);
    if (
      !contract ||
      planContentDigest(contract) !== planContentDigest(session.contract)
    )
      return assessmentFailed(result, "plan_acceptance_contract_unavailable");
    const terms = remoteAgentTerms(remote);
    if (!terms) return assessmentFailed(result);
    const assessed = await new AgentPlanStepAssessment(tasks).assess(
      { contract, instruction: terms.instruction, reach: terms.reach },
      result.output ?? "",
      {
        userId: run.userId,
        projectId: await input.projectId(),
        provider: terms.provider,
      },
      input.stepReport ?? null,
    );
    const accepted = assessed.acceptance.verdict === "accepted";
    return {
      ...result,
      output: planStepOutput(result.output ?? "", input.stepReport ?? null),
      status: accepted ? "succeeded" : "failed",
      error: accepted ? null : "plan_acceptance_failed",
      session: {
        ...session,
        contract: assessed.contract,
        acceptance: assessed.acceptance,
        resultCode: accepted ? 0 : -1,
      },
    };
  } catch {
    return assessmentFailed(result);
  }
}

/** Only the engine may turn this provisional runner result into accepted, checkpointed success. */
export function completedGatedRemote(
  remote: RemotePlanStep,
  step: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  if (
    remote.step.type !== "agent" ||
    (!remote.step.completionGate && !requiresRemoteAcceptance(remote)) ||
    step.status !== "running" ||
    step.remote?.status !== "completed"
  )
    return step;
  return {
    ...step,
    status: "succeeded",
    ...(step.session ? { session: { ...step.session, resultCode: 0 } } : {}),
  };
}
