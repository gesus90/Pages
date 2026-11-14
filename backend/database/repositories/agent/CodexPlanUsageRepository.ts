import { z } from "zod";

import {
  codexPriceSchema,
  codexTokenCountsSchema,
} from "@/definition/CodexPlanUsage";
import {
  codexHighWater,
  codexTokenCost,
  codexTokenDelta,
} from "@/backend/service/agents/usage/CodexUsageCalculation";
import { resolveCodexPrice } from "@/backend/service/agents/usage/OpenRouterPrices";

import { OpenRouterPriceRepository } from "./OpenRouterPriceRepository";
import { readUsageRow, USAGE_COLUMNS } from "./AgentSessionRows";
import { writeAgentSessionUsage } from "./AgentSessionUsageWriter";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { CodexPrice, CodexTokenCounts } from "@/definition/CodexPlanUsage";

const UNKNOWN_TOKENS: CodexTokenCounts = {
  inputTokens: null,
  cacheReadTokens: null,
  outputTokens: null,
  reasoningTokens: null,
};

function addCounts(
  before: AgentSessionTurnUsage | null,
  next: CodexTokenCounts,
): CodexTokenCounts {
  function sum(field: keyof CodexTokenCounts): number | null {
    const current = next[field];
    if (current === null) return before?.[field] ?? null;
    return (before?.[field] ?? 0) + current;
  }
  return {
    inputTokens: sum("inputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
  };
}

/** Atomically claims native thread growth and stores the same valuation used by display and monthly limits. */
export class CodexPlanUsageRepository {
  private readonly database: AgentSessionDatabase;

  public constructor(database: AgentSessionDatabase) {
    this.database = database;
  }

  /** A replayed outbox record or resumed thread cannot claim a cumulative counter twice. */
  public async save(usage: AgentSessionTurnUsage): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const delta = await this.claim(transaction, usage);
      if (delta === null) return;
      const [row] = await transaction.query(
        `
        SELECT ${USAGE_COLUMNS}
        FROM agent_session_turn_usage
        WHERE attempt_id = $attempt_id AND turn = $turn;
      `,
        { attempt_id: usage.attemptId, turn: usage.turn },
      );
      const before = row ? readUsageRow(row) : null;
      const isNativeReplay =
        usage.codex?.report &&
        !usage.codex.report.promptTokens &&
        Object.values(delta).every((count) => count === null || count === 0);
      if (isNativeReplay) return;
      // A missing final ACP response must not erase live native usage already recorded for this turn.
      if (
        !usage.codex?.report &&
        usage.inputTokens === null &&
        usage.outputTokens === null &&
        before &&
        (before.inputTokens !== null || before.outputTokens !== null)
      )
        return;
      const tokens = usage.codex?.report ? addCounts(before, delta) : delta;
      const price = await this.price(transaction, usage);
      await writeAgentSessionUsage(transaction, {
        ...usage,
        ...tokens,
        totalTokens:
          tokens.inputTokens === null || tokens.outputTokens === null
            ? null
            : tokens.inputTokens + tokens.outputTokens,
        reasoningTokens: tokens.reasoningTokens,
        isPartial: usage.isPartial || before?.isPartial === true,
        accounting: {
          price,
          costUsd: codexTokenCost(tokens, price),
          isSubscription: true,
        },
      });
    });
  }

  /** Known monthly equivalents, including subscription work, come from the persisted step valuations. */
  public async monthlyCost(agentId: string, month: string): Promise<number> {
    const [row] = await this.database.query(
      `
      SELECT COALESCE(SUM((usage.codex_accounting::jsonb ->> 'costUsd')::double precision), 0)
      FROM agent_session_turn_usage AS usage
      INNER JOIN agent_session_attempts AS attempt ON attempt.attempt_id = usage.attempt_id
      WHERE attempt.agent_id = $agent_id
          AND usage.provider = 'codex_cli'
          AND LEFT(usage.reported_at, 7) = $month;
    `,
      { agent_id: agentId, month },
    );
    return Number(row?.[0] ?? 0);
  }

  private async claim(
    transaction: DatabaseTransaction,
    usage: AgentSessionTurnUsage,
  ): Promise<CodexTokenCounts | null> {
    const source = usage.codex;
    const report = source?.report;
    if (!source || !report)
      return {
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens ?? null,
      };
    const parameters = {
      connection_id: source.connectionId,
      thread_id: report.threadId,
    };
    await transaction.execute(
      `
      INSERT INTO codex_thread_usage (connection_id, thread_id, totals)
      VALUES ($connection_id, $thread_id, $totals)
      ON CONFLICT (connection_id, thread_id) DO NOTHING;
    `,
      { ...parameters, totals: JSON.stringify(UNKNOWN_TOKENS) },
    );
    const [row] = await transaction.query(
      `
      SELECT totals FROM codex_thread_usage
      WHERE connection_id = $connection_id AND thread_id = $thread_id
      FOR UPDATE;
    `,
      parameters,
    );
    const before =
      typeof row?.[0] === "string"
        ? codexTokenCountsSchema.parse(JSON.parse(row[0]))
        : UNKNOWN_TOKENS;
    const current = await this.promptTotal(transaction, usage, before);
    const highest = codexHighWater(before, current);
    await transaction.execute(
      `
      UPDATE codex_thread_usage SET totals = $totals
      WHERE connection_id = $connection_id AND thread_id = $thread_id;
    `,
      { ...parameters, totals: JSON.stringify(highest) },
    );
    return report.baseline ? null : codexTokenDelta(before, current);
  }

  private async promptTotal(
    transaction: DatabaseTransaction,
    usage: AgentSessionTurnUsage,
    before: CodexTokenCounts,
  ): Promise<CodexTokenCounts> {
    const report = usage.codex?.report;
    if (!report) return UNKNOWN_TOKENS;
    const parameters = { attempt_id: usage.attemptId, turn: usage.turn };
    if (report.baseline) {
      const baseline = codexHighWater(before, report.totals);
      await transaction.execute(
        `
        INSERT INTO codex_prompt_baselines (attempt_id, turn, totals)
        VALUES ($attempt_id, $turn, $totals)
        ON CONFLICT (attempt_id, turn) DO NOTHING;
      `,
        { ...parameters, totals: JSON.stringify(baseline) },
      );
      return baseline;
    }
    if (!report.promptTokens) return report.totals;
    const [row] = await transaction.query(
      `
      SELECT totals FROM codex_prompt_baselines
      WHERE attempt_id = $attempt_id AND turn = $turn;
    `,
      parameters,
    );
    if (typeof row?.[0] !== "string")
      throw new Error("Codex prompt baseline is missing");
    const baseline = codexTokenCountsSchema.parse(JSON.parse(row[0]));
    const prompt = report.promptTokens;
    function cumulative(field: keyof CodexTokenCounts): number | null {
      const delta = prompt[field];
      return delta === null ? null : (baseline[field] ?? 0) + delta;
    }
    return {
      inputTokens: cumulative("inputTokens"),
      cacheReadTokens: cumulative("cacheReadTokens"),
      outputTokens: cumulative("outputTokens"),
      reasoningTokens: cumulative("reasoningTokens"),
    };
  }

  private async price(
    transaction: DatabaseTransaction,
    usage: AgentSessionTurnUsage,
  ): Promise<CodexPrice | null> {
    if (
      !usage.model ||
      usage.inputTokens === null ||
      usage.outputTokens === null
    )
      return null;
    const parameters = { attempt_id: usage.attemptId, model: usage.model };
    const [saved] = await transaction.query(
      `
      SELECT price FROM codex_plan_prices WHERE attempt_id = $attempt_id AND model = $model;
    `,
      parameters,
    );
    if (typeof saved?.[0] === "string")
      return codexPriceSchema.nullable().parse(JSON.parse(saved[0]));
    const [connection] = await transaction.query(
      `
      SELECT codex_price_mappings FROM agent_connections WHERE id = $id;
    `,
      { id: usage.codex?.connectionId ?? "" },
    );
    const mappings =
      typeof connection?.[0] === "string"
        ? z.record(z.string(), z.string()).parse(JSON.parse(connection[0]))
        : {};
    const catalog = await new OpenRouterPriceRepository(transaction).read();
    const price = resolveCodexPrice(
      catalog,
      usage.model,
      mappings[usage.model],
    );
    await transaction.execute(
      `
      INSERT INTO codex_plan_prices (attempt_id, model, price)
      VALUES ($attempt_id, $model, $price)
      ON CONFLICT (attempt_id, model) DO NOTHING;
    `,
      { ...parameters, price: JSON.stringify(price) },
    );
    return price;
  }
}
