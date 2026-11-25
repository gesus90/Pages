import { readNullableTextColumn } from "@/backend/database/RowValue";
import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import { runnerTurnTokens } from "@/definition/RunnerUsage";

import { writeAgentSessionUsage } from "../agent/AgentSessionUsageWriter";
import { CodexPlanUsageRepository } from "../agent/CodexPlanUsageRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

/**
 * Stores the terminal counts of a Codex turn with their valuation.
 * @remarks
 * The counts replace the interim reading of the same attempt and turn. The
 * repository values them at the price frozen for the attempt, so the amount
 * shown while the turn ran and the amount of its end rest on one price, and
 * the receipt at the end keeps an amount.
 */
async function saveCodexTerminalUsage(
  transaction: DatabaseTransaction,
  usage: AgentSessionTurnUsage,
): Promise<void> {
  const [attempt] = await transaction.query(
    `
    SELECT
        connection_id,
        agent_id
    FROM agent_session_attempts
    WHERE attempt_id = $attempt_id;
  `,
    { attempt_id: usage.attemptId },
  );
  const repository = new CodexPlanUsageRepository({
    ...transaction,
    transaction: async <Result>(
      work: (access: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  });
  await repository.save({
    ...usage,
    codex: {
      connectionId: attempt
        ? (readNullableTextColumn(attempt, 0, "connection_id") ?? "")
        : "",
      agentId: attempt
        ? (readNullableTextColumn(attempt, 1, "agent_id") ?? "")
        : "",
      report: null,
    },
  });
}

/**
 * Stores the terminal counts of a Claude turn with their valuation.
 * @remarks
 * The accounting values the counts at the price frozen for the attempt, so
 * the receipt at the end keeps an amount. Counts a session ledger allocated
 * from the job's own readings stay, because they hold the complete turn.
 */
async function saveClaudeTerminalUsage(
  transaction: DatabaseTransaction,
  usage: AgentSessionTurnUsage,
): Promise<void> {
  await accountClaudeUsage(
    {
      ...transaction,
      transaction: async <Result>(
        work: (access: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => work(transaction),
    },
    usage,
  );
}

/** Persists native terminal usage in the existing attempt/turn journal without inferring missing counts. */
export async function persistRunnerSessionUsage(
  transaction: DatabaseTransaction,
  step: AgentPlanStepResult,
): Promise<void> {
  const terminal = step.remote?.terminal;
  const record = step.session;
  if (!terminal || !record?.attemptId || record.runner === "api") return;
  const usage = terminal.usage;
  const provider = record.runner;
  if (
    provider !== "codex_cli" &&
    provider !== "claude_code" &&
    provider !== "opencode" &&
    provider !== "antigravity"
  )
    return;
  const normalized = runnerTurnTokens(provider, usage);
  if (!normalized) return;
  const stored: AgentSessionTurnUsage = {
    ...normalized,
    attemptId: record.attemptId,
    turn: 1,
    provider,
    model: record.requested.model,
    reportedAt: step.remote?.endedAt ?? new Date().toISOString(),
  };
  if (provider === "codex_cli")
    await saveCodexTerminalUsage(transaction, stored);
  else if (provider === "claude_code")
    await saveClaudeTerminalUsage(transaction, stored);
  else await writeAgentSessionUsage(transaction, stored);
}
