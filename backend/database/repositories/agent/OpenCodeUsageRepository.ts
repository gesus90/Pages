import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type { DatabaseValue } from "@/backend/database/Database";
import type { StoredOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";

function nullableCount(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number | null {
  return row[index] === null ? null : readCountColumn(row, index, column);
}

function nullableCost(row: readonly DatabaseValue[], index: number): number | null {
  const raw = row[index];
  const amount = typeof raw === "string" ? Number(raw) : raw;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? amount
    : null;
}

function readUsage(row: readonly DatabaseValue[]): StoredOpenCodeUsage {
  const state = readTextColumn(row, 11, "price_state");
  if (state !== "free" && state !== "catalog" && state !== "native" && state !== "unknown")
    throw new Error("Invalid OpenCode price state");
  return {
    id: readTextColumn(row, 0, "message_id"),
    sessionId: readTextColumn(row, 1, "session_id"),
    attemptId: readTextColumn(row, 2, "attempt_id"),
    turn: readCountColumn(row, 3, "turn"),
    model: readNullableTextColumn(row, 4, "model"),
    inputTokens: nullableCount(row, 5, "input_tokens"),
    outputTokens: nullableCount(row, 6, "output_tokens"),
    reasoningTokens: nullableCount(row, 7, "reasoning_tokens"),
    cacheReadTokens: nullableCount(row, 8, "cache_read_tokens"),
    cacheWriteTokens: nullableCount(row, 9, "cache_write_tokens"),
    costUsd: null,
    price: {
      amount: nullableCost(row, 10),
      state,
      priceAsOf: readNullableTextColumn(row, 12, "price_as_of"),
    },
    reportedAt: readTextColumn(row, 13, "reported_at"),
  };
}

/** Stores native message IDs once across turns, attempts and process restarts. */
export class OpenCodeUsageRepository {
  private readonly database: AgentSessionDatabase;

  public constructor(database: AgentSessionDatabase) {
    this.database = database;
  }

  /** Replaces a message's current counters while retaining its first owner. */
  public async save(message: StoredOpenCodeUsage): Promise<void> {
    await this.database.execute(
      `INSERT INTO agent_opencode_message_usage (
          message_id,
          session_id,
          attempt_id,
          turn,
          model,
          input_tokens,
          output_tokens,
          reasoning_tokens,
          cache_read_tokens,
          cache_write_tokens,
          cost_usd,
          price_state,
          price_as_of,
          reported_at
      ) VALUES (
          $message_id,
          $session_id,
          $attempt_id,
          $turn,
          $model,
          $input_tokens,
          $output_tokens,
          $reasoning_tokens,
          $cache_read_tokens,
          $cache_write_tokens,
          $cost_usd,
          $price_state,
          $price_as_of,
          $reported_at
      ) ON CONFLICT (message_id) DO UPDATE SET
          model = excluded.model,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          reasoning_tokens = excluded.reasoning_tokens,
          cache_read_tokens = excluded.cache_read_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          cost_usd = excluded.cost_usd,
          price_state = excluded.price_state,
          price_as_of = excluded.price_as_of,
          reported_at = excluded.reported_at;`,
      {
        message_id: message.id,
        session_id: message.sessionId,
        attempt_id: message.attemptId,
        turn: message.turn,
        model: message.model,
        input_tokens: message.inputTokens,
        output_tokens: message.outputTokens,
        reasoning_tokens: message.reasoningTokens,
        cache_read_tokens: message.cacheReadTokens,
        cache_write_tokens: message.cacheWriteTokens,
        cost_usd: message.price.amount,
        price_state: message.price.state,
        price_as_of: message.price.priceAsOf,
        reported_at: message.reportedAt,
      },
    );
  }

  /** Reads every native message of a run for step and run totals. */
  public async listRun(runId: string): Promise<readonly StoredOpenCodeUsage[]> {
    const rows = await this.database.query(
      `SELECT
          usage.message_id,
          usage.session_id,
          usage.attempt_id,
          usage.turn,
          usage.model,
          usage.input_tokens,
          usage.output_tokens,
          usage.reasoning_tokens,
          usage.cache_read_tokens,
          usage.cache_write_tokens,
          usage.cost_usd,
          usage.price_state,
          usage.price_as_of,
          usage.reported_at
      FROM agent_opencode_message_usage usage
      INNER JOIN agent_session_attempts attempts
          ON attempts.attempt_id = usage.attempt_id
      WHERE attempts.run_id = $run_id
      ORDER BY usage.reported_at, usage.message_id;`,
      { run_id: runId },
    );
    return rows.map(readUsage);
  }
}
