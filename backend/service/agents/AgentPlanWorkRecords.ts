import { planWorkContext } from "./AgentPlanWorkContext";

import type { AgentPlanWorkRepository } from "@/backend/database/repositories/agent/AgentPlanWorkRepository";
import type { AgentPlanWorkRecord } from "@/definition/AgentPlanWork";
import type { PlanWorkContext } from "./AgentPlanWorkContext";

/** Reuses proof only for a checkpoint-verified successful predecessor, never a retried attempt. */
export async function readPlanWorkRecordForContext(
  repository: Pick<AgentPlanWorkRepository, "find" | "basis">,
  context: PlanWorkContext,
  ticketId: string,
): Promise<AgentPlanWorkRecord | null> {
  let current = context;
  const visited = new Set<string>();
  while (!visited.has(current.run.id)) {
    visited.add(current.run.id);
    const record = await repository.find({ ...current.key, ticketId });
    if (record) return record;
    const origin = current.run.origin;
    if (
      current.result.status !== "succeeded" ||
      origin?.kind !== "resume" ||
      !origin.reusedStepIds.includes(current.step.id)
    )
      return null;
    const basis = await repository.basis(origin.runId);
    if (
      !basis ||
      basis.run.userId !== context.run.userId ||
      basis.run.planId !== context.run.planId
    )
      return null;
    const source = planWorkContext(basis, current.step.id);
    if (
      source.result.status !== "succeeded" ||
      source.key.attemptId !== context.key.attemptId ||
      source.projectId !== context.projectId ||
      !source.ticketIds.includes(ticketId)
    )
      return null;
    current = source;
  }
  return null;
}
