import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { readPlanStepTickets } from "@/backend/agents/AgentPlanStepTickets";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type {
  AgentPlanRun,
  AgentPlanStep,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanWorkKey } from "@/backend/database/repositories/agent/AgentPlanWorkRepository";

/** Validated execution identity and bound resources; supplied IDs never establish authority. */
export interface PlanWorkContext {
  readonly run: AgentPlanRun;
  readonly step: AgentPlanStep;
  readonly result: AgentPlanStepResult;
  readonly ticketIds: readonly string[];
  readonly projectId: string;
  readonly key: Omit<PlanWorkKey, "ticketId">;
}

/** Finds the explicit gate in the pinned local or remote execution graph. */
export function planWorkStep(
  snapshot: Record<string, unknown>,
  stepId: string,
): AgentPlanStep | null {
  const plan = readAgentObject(snapshot.plan);
  const nodes: readonly unknown[] = Array.isArray(plan.nodes) ? plan.nodes : [];
  for (const raw of nodes) {
    const node = readAgentObject(raw);
    if (node.id === stepId && node.type === "agent") {
      const parsed = readPlanNode(node);
      if (parsed.type === "agent") return parsed;
    }
    const members: readonly unknown[] = Array.isArray(node.steps)
      ? node.steps
      : [];
    const member = members.find(
      (entry) => readAgentObject(entry).id === stepId,
    );
    if (member) {
      const parsed = readPlanNode(member);
      if (parsed.type === "agent") return parsed;
    }
  }
  return null;
}

/** Resolves the live attempt instead of accepting one from a reporting client. */
export function planWorkContext(
  basis: {
    readonly run: AgentPlanRun;
    readonly snapshot: Record<string, unknown>;
  },
  stepId: string,
): PlanWorkContext {
  const step = planWorkStep(basis.snapshot, stepId);
  const result = basis.run.steps.find((entry) => entry.id === stepId);
  const attemptId =
    result?.session?.attemptId ??
    result?.execution?.attemptId ??
    result?.session?.instanceId;
  if (!step?.completionGate || !result || !attemptId)
    throw new AgentOperationError("FORBIDDEN");
  return {
    run: basis.run,
    step,
    result,
    projectId: String(readAgentObject(basis.snapshot.plan).projectId),
    ticketIds: readPlanStepTickets(basis.snapshot)[stepId] ?? [],
    key: { runId: basis.run.id, stepId, attemptId },
  };
}
