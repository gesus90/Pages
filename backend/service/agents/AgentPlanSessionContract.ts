import { readPlanStepTickets } from "@/backend/agents/AgentPlanStepTickets";

import { buildPlanContract } from "./AgentPlanContract";
import { planSessionReach } from "./AgentPlanSessionAccess";

import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { PreparedPlanStep } from "./AgentPlanStepStart";
import type { AgentPlanTasks } from "./AgentPlanTasks";

/** Extracts the effective ticket bindings after the current stack entry has been resolved. */
export async function buildSessionContract(
  node: NodeRun,
  prepared: PreparedPlanStep,
  tasks: Pick<AgentPlanTasks, "checklist">,
): Promise<AgentPlanSessionTerms> {
  const { run, step, snapshot } = node;
  const tickets = await Promise.all(
    (readPlanStepTickets({ steps: [step] })[step.step.id] ?? []).map((taskId) =>
      tasks.checklist(run.userId, snapshot.plan.projectId, taskId),
    ),
  );
  const reach = planSessionReach(
    prepared.input.agent.connection.provider,
    prepared.options,
  );
  const instruction = prepared.instruction ?? step.step.instruction;
  return {
    reach,
    instruction,
    contract: buildPlanContract(instruction, tickets, {
      isReadOnly: reach === "read",
      completion: step.step.completion,
      completionGate: step.step.completionGate,
    }),
  };
}

/** Persists the iteration's initial TODO states before any provider can start working. */
export async function initializeSessionTodos(
  node: NodeRun,
  contract: AgentPlanContract,
  progress:
    Partial<Pick<AgentPlanStepProgressService, "initialize">> | undefined,
): Promise<AgentPlanContract> {
  if (!node.record?.attemptId) return contract;
  return (
    (await progress?.initialize?.(
      {
        runId: node.run.id,
        stepId: node.step.step.id,
        attemptId: node.record.attemptId,
        iteration: JSON.stringify([
          node.loop?.loopId ?? null,
          node.loop?.iteration ?? null,
          node.event?.activation ?? 1,
        ]),
        sourceRunId: node.run.origin?.runId,
      },
      contract,
    )) ?? contract
  );
}
