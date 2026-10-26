import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";

import { persistRunnerSessionUsage } from "./RunnerSessionUsage";
import { appendSessionHistoryChunks } from "../agent/AgentSessionHistoryChunks";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";

/** Writes remote history in the same transaction as its receipt and the immutable plan progress. */
export async function persistRunnerSessionEvents(
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
  input: {
    readonly stepId: string;
    readonly events: readonly RunnerLiveEvent[];
  },
): Promise<void> {
  const step = run.steps.find((entry) => entry.id === input.stepId);
  const record = step?.session;
  if (!record?.attemptId || step?.remote?.liveHistoryVersion !== 1) return;
  const state = step.status === "succeeded" ? "ended" : step.status;
  const next = (input.events.at(-1)?.sequence ?? 0) + 1;
  await transaction.execute(
    `
    INSERT INTO agent_session_attempts (
        attempt_id,
        plan_id,
        run_id,
        step_id,
        user_id,
        provider,
        instance_id,
        state,
        next_sequence,
        updated_at
    ) VALUES (
        $attempt_id, $plan_id, $run_id, $step_id, $user_id,
        $provider, $instance_id, $state, $next_sequence, $updated_at
    )
    ON CONFLICT (attempt_id) DO UPDATE SET
        state = excluded.state,
        next_sequence = GREATEST(agent_session_attempts.next_sequence, excluded.next_sequence),
        updated_at = excluded.updated_at;
  `,
    {
      attempt_id: record.attemptId,
      plan_id: run.planId,
      run_id: run.id,
      step_id: step.id,
      user_id: run.userId,
      provider: record.runner,
      instance_id: record.instanceId,
      state,
      next_sequence: next,
      updated_at: new Date().toISOString(),
    },
  );
  await persistRunnerSessionUsage(transaction, step);
  await appendRunnerSessionEvents(transaction, {
    binding: {
      planId: run.planId,
      runId: run.id,
      stepId: step.id,
      attemptId: record.attemptId,
      planRevision: run.planRevision,
    },
    jobId: record.instanceId,
    ...(step.remote.outputJournalVersion === 2
      ? { launchId: step.remote.launchId }
      : {}),
    events: input.events,
  });
}

/** Appends diagnostics to the already bound attempt without changing its terminal result or checkpoint. */
export async function appendRunnerSessionEvents(
  transaction: DatabaseTransaction,
  input: {
    readonly binding: RunnerPlanBinding;
    readonly jobId: string;
    readonly launchId?: string;
    readonly events: readonly RunnerLiveEvent[];
  },
): Promise<void> {
  const [attempt] = await transaction.query(
    `
    SELECT attempt_id
    FROM agent_session_attempts
    WHERE attempt_id = $attempt_id
        AND plan_id = $plan_id
        AND run_id = $run_id
        AND step_id = $step_id
        AND instance_id = $job_id;
  `,
    {
      attempt_id: input.binding.attemptId,
      plan_id: input.binding.planId,
      run_id: input.binding.runId,
      step_id: input.binding.stepId,
      job_id: input.jobId,
    },
  );
  if (!attempt) throw new Error("Runner session binding mismatch");
  for (const event of input.events) {
    const text = sanitizePlanOutput(event.text);
    await transaction.execute(
      `
      INSERT INTO agent_session_events (
          attempt_id,
          sequence,
          turn,
          kind,
          body,
          is_truncated,
          created_at
      ) VALUES ($attempt_id, $sequence, 1, $kind, $body, $is_truncated, $created_at);
    `,
      {
        attempt_id: input.binding.attemptId,
        sequence: event.sequence,
        kind: event.kind,
        body: text.slice(0, 4_000),
        is_truncated: event.isTruncated || text.length > 4_000,
        created_at: event.createdAt,
      },
    );
  }
  if (input.launchId)
    await appendSessionHistoryChunks(
      transaction,
      {
        attemptId: input.binding.attemptId,
        launchId: input.launchId,
      },
      input.events.map((event) => ({
        ...event,
        id: `${input.binding.attemptId}:${event.sequence}`,
        attemptId: input.binding.attemptId,
        stepId: input.binding.stepId,
        turn: 1,
        text: sanitizePlanOutput(event.text),
      })),
    );
  const next = (input.events.at(-1)?.sequence ?? 0) + 1;
  await transaction.execute(
    `
    UPDATE agent_session_attempts
    SET next_sequence = GREATEST(next_sequence, $next_sequence)
    WHERE attempt_id = $attempt_id;
  `,
    { attempt_id: input.binding.attemptId, next_sequence: next },
  );
  if (next > 2_001)
    await transaction.execute(
      `
      DELETE FROM agent_session_events
      WHERE attempt_id = $attempt_id
          AND sequence < $first_kept;
    `,
      { attempt_id: input.binding.attemptId, first_kept: next - 2_000 },
    );
}
