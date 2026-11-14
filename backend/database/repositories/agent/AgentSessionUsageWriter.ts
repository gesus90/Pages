import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

/** Stores normalized turn counters and their frozen Codex valuation in the same row. */
export async function writeAgentSessionUsage(
  database: DatabaseTransaction,
  usage: AgentSessionTurnUsage,
): Promise<void> {
  await database.execute(
    `
      INSERT INTO agent_session_turn_usage (
          attempt_id,
          turn,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          total_tokens,
          input_includes_cache,
          is_partial,
          reported_at,
          reasoning_tokens,
          codex_accounting
      )
      VALUES (
          $attempt_id,
          $turn,
          $provider,
          $model,
          $input_tokens,
          $output_tokens,
          $cache_read_tokens,
          $cache_write_tokens,
          $total_tokens,
          $input_includes_cache,
          $is_partial,
          $reported_at,
          $reasoning_tokens,
          $codex_accounting
      )
      ON CONFLICT (attempt_id, turn) DO UPDATE SET
          model = excluded.model,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cache_read_tokens = excluded.cache_read_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          total_tokens = excluded.total_tokens,
          input_includes_cache = excluded.input_includes_cache,
          is_partial = excluded.is_partial,
          reported_at = excluded.reported_at,
          reasoning_tokens = excluded.reasoning_tokens,
          codex_accounting = excluded.codex_accounting;
    `,
    {
      attempt_id: usage.attemptId,
      turn: usage.turn,
      provider: usage.provider,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      total_tokens: usage.totalTokens,
      input_includes_cache: usage.inputIncludesCache,
      is_partial: usage.isPartial,
      reported_at: usage.reportedAt,
      reasoning_tokens: usage.reasoningTokens ?? null,
      codex_accounting: usage.accounting
        ? JSON.stringify(usage.accounting)
        : null,
    },
  );
}
