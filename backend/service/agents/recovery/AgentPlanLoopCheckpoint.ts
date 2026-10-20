import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopIterationCheckpoint,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";

function iterationOf(
  loop: AgentPlanLoopRun | undefined,
  number: number,
): AgentPlanLoopIteration | undefined {
  return loop?.iterations.find((entry) => entry.number === number);
}

/**
 * Builds the checkpoints of the iterations that completed since the last write.
 *
 * @param previous - The run as it was stored.
 * @param run - The run about to be stored.
 * @returns One checkpoint per iteration that is `succeeded` now and was not before.
 */
export function loopIterationCheckpoints(
  previous: AgentPlanRun,
  run: AgentPlanRun,
): readonly AgentPlanLoopIterationCheckpoint[] {
  return (run.loops ?? []).flatMap((loop) =>
    loop.iterations.flatMap((iteration) => {
      const before = iterationOf(
        previous.loops?.find((entry) => entry.id === loop.id),
        iteration.number,
      );
      if (iteration.status !== "succeeded" || before?.status === "succeeded")
        return [];
      if (!loop.count) throw new AgentPlanRecoveryError("checkpoint_invalid");
      return [
        {
          schemaVersion: 1 as const,
          runId: run.id,
          loopId: loop.id,
          iteration: iteration.number,
          completedAt: iteration.endedAt ?? new Date().toISOString(),
          count: loop.count,
          condition: iteration.condition,
          nodes: iteration.nodes.map((node) => ({
            id: node.id,
            status: node.status,
            output: node.output,
            outputDigest: planContentDigest(node.output),
            session: node.session
              ? {
                  attemptId: node.session.attemptId ?? null,
                  instanceId: node.session.instanceId,
                  sessionId: node.session.sessionId,
                  loop: node.session.loop ?? null,
                }
              : null,
          })),
        },
      ];
    }),
  );
}

/**
 * Refuses to change an iteration that already succeeded.
 *
 * @param previous - The run as it was stored.
 * @param run - The run about to be stored.
 * @param digest - The digest of the work of a node, which leaves out only
 * what legitimately changes later, such as the closeout of its session.
 * @throws {AgentPlanRecoveryError} `checkpoint_invalid` when a completed
 * iteration, its count or its results would change.
 */
export function requireImmutableIterations(
  previous: AgentPlanRun,
  run: AgentPlanRun,
  digest: (node: AgentPlanStepResult) => string,
): void {
  for (const loop of previous.loops ?? []) {
    const next = run.loops?.find((entry) => entry.id === loop.id);
    for (const done of loop.iterations.filter(
      (entry) => entry.status === "succeeded",
    )) {
      const current = iterationOf(next, done.number);
      if (
        current?.status !== "succeeded" ||
        JSON.stringify(next?.count) !== JSON.stringify(loop.count) ||
        JSON.stringify(current.condition) !== JSON.stringify(done.condition) ||
        current.nodes.length !== done.nodes.length ||
        done.nodes.some((node, index) => {
          const other = current.nodes[index];
          return other === undefined || digest(other) !== digest(node);
        })
      )
        throw new AgentPlanRecoveryError("checkpoint_invalid");
    }
  }
}
