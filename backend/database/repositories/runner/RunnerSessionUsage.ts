import { runnerTurnTokens } from "@/definition/RunnerUsage";

import { writeAgentSessionUsage } from "../agent/AgentSessionUsageWriter";

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
  await writeAgentSessionUsage(transaction, {
    ...normalized,
    attemptId: record.attemptId,
    turn: 1,
    provider,
    model: record.requested.model,
    reportedAt: step.remote?.endedAt ?? new Date().toISOString(),
  });
}
