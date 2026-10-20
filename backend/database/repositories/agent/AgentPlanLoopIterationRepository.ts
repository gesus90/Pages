import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanLoopIterationCheckpoint } from "@/definition/AgentPlanLoopRun";

/** The serialized UTF-8 bound of one iteration record. */
const MAXIMUM_ITERATION_BYTES = 2_097_152;

/** Immutable records of completed loop iterations, written in the transaction of their run. */
export class AgentPlanLoopIterationRepository {
  /**
   * Appends a completed iteration once.
   *
   * @param transaction - The transaction that also stores the run view.
   * @param input - The completed iteration.
   * @param runRevision - The recovery revision of the run write.
   * @throws {AgentPlanRecoveryError} `checkpoint_too_large` for a record over
   * the bound, `checkpoint_invalid` when the iteration was stored with
   * different content before.
   */
  public async append(
    transaction: DatabaseTransaction,
    input: AgentPlanLoopIterationCheckpoint,
    runRevision: number,
  ): Promise<void> {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_ITERATION_BYTES)
      throw new AgentPlanRecoveryError("checkpoint_too_large");
    const [existing] = await transaction.query(
      `
        SELECT iteration_json
        FROM agent_plan_loop_iterations
        WHERE run_id = $run_id
            AND loop_id = $loop_id
            AND iteration = $iteration;
      `,
      {
        run_id: input.runId,
        loop_id: input.loopId,
        iteration: input.iteration,
      },
    );
    if (existing) {
      if (readTextColumn(existing, 0, "iteration_json") !== serialized)
        throw new AgentPlanRecoveryError("checkpoint_invalid");
      return;
    }
    await transaction.execute(
      `
        INSERT INTO agent_plan_loop_iterations (
            run_id,
            loop_id,
            iteration,
            run_revision,
            completed_at,
            count_source,
            count_mode,
            effective_count,
            condition_state,
            condition_met,
            iteration_json
        )
        VALUES (
            $run_id,
            $loop_id,
            $iteration,
            $run_revision,
            $completed_at,
            $count_source,
            $count_mode,
            $effective_count,
            $condition_state,
            $condition_met,
            $iteration_json
        );
      `,
      {
        run_id: input.runId,
        loop_id: input.loopId,
        iteration: input.iteration,
        run_revision: runRevision,
        completed_at: input.completedAt,
        count_source: input.count.source,
        count_mode: input.count.mode,
        effective_count: input.count.effective,
        condition_state:
          input.condition.state === "evaluated" ? "evaluated" : "not_evaluated",
        condition_met:
          input.condition.state === "evaluated" ? input.condition.isMet : null,
        iteration_json: serialized,
      },
    );
  }
}
