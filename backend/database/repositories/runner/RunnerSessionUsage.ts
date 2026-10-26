import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Persists native terminal usage in the existing attempt/turn journal without inferring missing counts. */
export async function persistRunnerSessionUsage(
  transaction: DatabaseTransaction,
  step: AgentPlanStepResult,
): Promise<void> {
  const terminal = step.remote?.terminal;
  const record = step.session;
  if (!terminal || !record?.attemptId || record.runner === "api") return;
  const usage = terminal.usage;
  await transaction.execute(
    `
    INSERT INTO agent_session_turn_usage (
        attempt_id, turn, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, total_tokens, input_includes_cache,
        is_partial, reported_at
    ) VALUES (
        $attempt_id, 1, $provider, $model, $input_tokens, $output_tokens,
        $cache_read_tokens, $cache_write_tokens, $total_tokens, NULL,
        $is_partial, $reported_at
    )
    ON CONFLICT (attempt_id, turn) DO NOTHING;
  `,
    {
      attempt_id: record.attemptId,
      provider: record.runner,
      model: record.requested.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
      is_partial: usage.inputTokens === null || usage.outputTokens === null,
      reported_at: step.remote?.endedAt ?? new Date().toISOString(),
    },
  );
}
