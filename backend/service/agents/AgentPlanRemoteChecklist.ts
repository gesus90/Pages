import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { RemotePlanParameters } from "./AgentPlanRemoteParameters";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

/** Reads the real checklist identities of a remote TODO node with the executor's current rights. */
export async function remoteTodoChecklists(input: {
  readonly step: AgentPlanStep;
  readonly parameters: RemotePlanParameters | undefined;
  readonly tasks: Pick<AgentPlanTasks, "checklist"> | undefined;
  readonly userId: string;
  readonly projectId: string;
}): Promise<readonly AgentPlanTicketChecklist[]> {
  if (input.step.completion !== "todos") return [];
  const ids = Object.keys(input.parameters?.tickets ?? {});
  if (!ids.length) return [];
  const tasks = input.tasks;
  if (!tasks) throw new AgentError("plan_binding_invalid");
  return Promise.all(
    ids.map((id) => tasks.checklist(input.userId, input.projectId, id)),
  );
}
