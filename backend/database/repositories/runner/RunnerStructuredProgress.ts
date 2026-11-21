import { claudeObservationSchema } from "@/definition/ClaudeUsage";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { isAgentProvider } from "@/definition/AgentConnection";
import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import {
  readTextColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";
import {
  mergeAgentTodos,
  readPlanEventEntries,
} from "@/definition/AgentPlanAgentTodos";
import { runnerTerminalSchema } from "@/definition/RunnerTerminal";
import { runnerTurnTokens } from "@/definition/RunnerUsage";
import { readRunnerSessionReading } from "@/definition/RunnerSessionReading";

import { AgentPlanAgentTodoRepository } from "../agent/AgentPlanAgentTodoRepository";
import { AgentSessionRepository } from "../agent/AgentSessionRepository";
import { persistRunnerSessionReading } from "./RunnerSessionReadings";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";

interface StructuredProgressInput {
  readonly attemptId: string;
  readonly turn?: number;
  readonly event: RunnerLiveEvent;
  readonly hasTerminalUsage: boolean;
}

/**
 * Stores the model and context reading of a native runner job.
 * @returns Whether the event was a session reading, valid or dropped, and
 * therefore no token counters.
 */
async function persistSessionReading(
  transaction: DatabaseTransaction,
  input: StructuredProgressInput,
): Promise<boolean> {
  const reading = readRunnerSessionReading(input.event.text);
  if (reading === undefined) return false;
  if (reading !== null)
    await persistRunnerSessionReading(transaction, {
      attemptId: input.attemptId,
      reading,
      reportedAt: input.event.createdAt,
    });
  return true;
}

/** Projects structured runner updates into the same TODO, usage and session tables as local sessions. */
export async function persistRunnerStructuredProgress(
  transaction: DatabaseTransaction,
  input: StructuredProgressInput,
): Promise<void> {
  const { attemptId, event } = input;
  // Session readings hold no tokens, so a terminal receipt never replaces them.
  if (
    event.kind === "usage" &&
    (await persistSessionReading(transaction, input))
  )
    return;
  if (event.kind === "plan") {
    const entries = readPlanEventEntries(event.text);
    if (entries === null) return;
    const repository = new AgentPlanAgentTodoRepository(transaction);
    const previous = await repository.findEntries(attemptId);
    await repository.save(
      attemptId,
      mergeAgentTodos(entries, previous, event.createdAt),
      event.createdAt,
    );
  }
  if (event.kind !== "usage" || input.hasTerminalUsage) return;
  await persistRunnerUsage(transaction, input);
}

async function persistRunnerUsage(
  transaction: DatabaseTransaction,
  input: StructuredProgressInput,
): Promise<void> {
  const { attemptId, event } = input;
  const reading = runnerTerminalSchema.shape.usage
    .extend({ claudeObservation: claudeObservationSchema.optional() })
    .parse(JSON.parse(event.text));
  const { claudeObservation, ...usage } = reading;
  const [attempt] = await transaction.query(
    `
    SELECT provider, requested_model, state, connection_id, agent_id
    FROM agent_session_attempts
    WHERE attempt_id = $attempt_id;
  `,
    { attempt_id: attemptId },
  );
  if (!attempt) return;
  const provider = readTextColumn(attempt, 0, "provider");
  if (!isAgentProvider(provider) || !isAcpProvider(provider)) return;
  const normalized = runnerTurnTokens(
    provider === "openrouter" ? "opencode" : provider,
    usage,
  );
  if (!normalized) return;
  const stored: AgentSessionTurnUsage = {
    ...normalized,
    isPartial: normalized.isPartial,
    attemptId,
    turn: input.turn ?? 1,
    provider,
    model: readNullableTextColumn(attempt, 1, "requested_model"),
    reportedAt: event.createdAt,
    ...(provider === "codex_cli"
      ? {
          codex: {
            connectionId:
              readNullableTextColumn(attempt, 3, "connection_id") ?? "",
            agentId: readNullableTextColumn(attempt, 4, "agent_id") ?? "",
            report: null,
          },
        }
      : {}),
    ...(claudeObservation ? { claudeObservation } : {}),
  };
  const database = {
    ...transaction,
    transaction: async <Result>(
      work: (access: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
  if (provider === "claude_code") await accountClaudeUsage(database, stored);
  else await new AgentSessionRepository(database).saveTurnUsage(stored);
}
