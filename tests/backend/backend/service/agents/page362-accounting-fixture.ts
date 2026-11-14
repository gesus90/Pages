import { vi } from "vitest";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentSessionDatabase } from "@/backend/database/repositories/agent/AgentSessionDatabase";

/** Mocked SQL boundary retains the rows that production accounting writes; no database is started. */
export class CodexAccountingDatabase implements AgentSessionDatabase {
  public readonly watermarks = new Map<string, string>();
  public readonly baselines = new Map<string, string>();
  public readonly turns = new Map<string, DatabaseValue[]>();
  public readonly prices = new Map<string, string>();
  public catalog = JSON.stringify({
    fetchedAt: "2026-11-14",
    models: [
      {
        id: "openai/gpt-6-luna",
        pricing: {
          prompt: 0.001,
          completion: 0.01,
          input_cache_read: 0.0001,
          internal_reasoning: 0.02,
        },
      },
    ],
  });
  public mappings = "{}";
  public shouldFailWrite = false;
  public readonly statements: string[] = [];

  /** Models only the writes owned by PAGE-362. */
  public readonly execute = vi.fn(
    async (
      statement: string,
      parameters: SqlParameters = {},
    ): Promise<void> => {
      this.statements.push(statement);
      const thread = `${parameters.connection_id}/${parameters.thread_id}`;
      if (statement.includes("INSERT INTO codex_thread_usage")) {
        if (!this.watermarks.has(thread))
          this.watermarks.set(thread, String(parameters.totals));
      } else if (statement.includes("UPDATE codex_thread_usage"))
        this.watermarks.set(thread, String(parameters.totals));
      else if (statement.includes("INSERT INTO codex_plan_prices"))
        this.prices.set(
          `${parameters.attempt_id}/${parameters.model}`,
          String(parameters.price),
        );
      else if (statement.includes("INSERT INTO agent_session_turn_usage")) {
        if (this.shouldFailWrite) throw new Error("write failed");
        const names = [
          "attempt_id",
          "turn",
          "provider",
          "model",
          "input_tokens",
          "output_tokens",
          "cache_read_tokens",
          "cache_write_tokens",
          "total_tokens",
          "input_includes_cache",
          "is_partial",
          "reported_at",
          "reasoning_tokens",
          "codex_accounting",
        ];
        this.turns.set(
          `${parameters.attempt_id}/${parameters.turn}`,
          names.map((name) => {
            const entry = parameters[name];
            return typeof entry === "boolean" ? Number(entry) : (entry ?? null);
          }),
        );
      } else if (statement.includes("INSERT INTO codex_prompt_baselines")) {
        const key = `${parameters.attempt_id}/${parameters.turn}`;
        if (!this.baselines.has(key))
          this.baselines.set(key, String(parameters.totals));
      } else throw new Error("Unexpected accounting write");
    },
  );

  /** Returns positional rows in the real repository's explicit column order. */
  public readonly query = vi.fn(
    async (
      statement: string,
      parameters: SqlParameters = {},
    ): Promise<readonly DatabaseValue[][]> => {
      this.statements.push(statement);
      if (statement.includes("SELECT totals FROM codex_prompt_baselines")) {
        const baseline = this.baselines.get(
          `${parameters.attempt_id}/${parameters.turn}`,
        );
        return baseline ? [[baseline]] : [];
      }
      if (statement.includes("SELECT totals FROM codex_thread_usage")) {
        const totals = this.watermarks.get(
          `${parameters.connection_id}/${parameters.thread_id}`,
        );
        return totals ? [[totals]] : [];
      }
      if (statement.includes("FROM agent_session_turn_usage")) {
        const row = this.turns.get(
          `${parameters.attempt_id}/${parameters.turn}`,
        );
        return row ? [row] : [];
      }
      if (statement.includes("SELECT price FROM codex_plan_prices")) {
        const price = this.prices.get(
          `${parameters.attempt_id}/${parameters.model}`,
        );
        return price ? [[price]] : [];
      }
      if (statement.includes("SELECT payload FROM openrouter_price_catalog"))
        return [[this.catalog]];
      if (statement.includes("SELECT codex_price_mappings"))
        return [[this.mappings]];
      throw new Error("Unexpected accounting query");
    },
  );

  /** Transaction failures restore both the counter claim and the turn valuation. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const before = {
      watermarks: new Map(this.watermarks),
      turns: new Map(this.turns),
      prices: new Map(this.prices),
      baselines: new Map(this.baselines),
    };
    try {
      return await work(this);
    } catch (error: unknown) {
      this.watermarks.clear();
      this.turns.clear();
      this.prices.clear();
      this.baselines.clear();
      for (const [key, entry] of before.baselines)
        this.baselines.set(key, entry);
      for (const [key, entry] of before.watermarks)
        this.watermarks.set(key, entry);
      for (const [key, entry] of before.turns) this.turns.set(key, entry);
      for (const [key, entry] of before.prices) this.prices.set(key, entry);
      throw error;
    }
  }
}
