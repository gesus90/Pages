import { z } from "zod";

import { claudeObservationSchema } from "@/definition/ClaudeUsage";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { isAgentProvider } from "@/definition/AgentConnection";
import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import { nativeOpenCodePrice } from "@/backend/service/agents/sessions/OpenCodeUsage";
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
import { readRunnerOpenCodeMessage } from "@/definition/RunnerOpenCodeMessage";
import { readRunnerSessionReading } from "@/definition/RunnerSessionReading";

import { AgentPlanAgentTodoRepository } from "../agent/AgentPlanAgentTodoRepository";
import { AgentSessionRepository } from "../agent/AgentSessionRepository";
import { OpenCodeUsageRepository } from "../agent/OpenCodeUsageRepository";
import { persistRunnerSessionReading } from "./RunnerSessionReadings";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { ClaudeUsageObservation } from "@/definition/ClaudeUsage";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";

interface StructuredProgressInput {
  readonly attemptId: string;
  readonly turn?: number;
  readonly event: RunnerLiveEvent;
  readonly hasTerminalUsage: boolean;
}

/**
 * The token counters of a `usage` event.
 * @remarks
 * `isInterim` marks the counters of a turn that still runs, as a Codex job
 * reads them from its rollout and a Claude job from the answers of its turn:
 * they count only part of the turn, and the counters of the turn's end
 * replace them.
 */
const runnerUsageEventSchema = runnerTerminalSchema.shape.usage.extend({
  claudeObservation: claudeObservationSchema.optional(),
  isInterim: z.boolean().optional(),
});

/**
 * The observation of a Claude job as the session ledger takes it.
 * @remarks
 * The result of a job names the totals of its whole native session, also
 * across the jobs that resumed it. Runners before 1.25.3 sent them as the
 * reading of one answer, which the ledger adds to the session; as totals the
 * ledger gives the turn only the difference to the totals before.
 */
function ledgerObservation(
  observation: ClaudeUsageObservation,
): ClaudeUsageObservation {
  return observation.kind === "message" && observation.id.startsWith("runner:")
    ? { ...observation, kind: "total" }
    : observation;
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

/**
 * Stores the usage of a model step an OpenCode job read from its session database.
 * @returns Whether the event was such a usage, valid or dropped, and
 * therefore no token counters.
 * @remarks
 * A step is one native message, stored once under its identity with the
 * attempt that reported it first, like the messages a session on the Pages
 * host reads itself. A job reports only the steps of its own prompt, so a
 * message another attempt owns is left as it is. The price is the cost
 * OpenCode reported for the step.
 */
async function persistOpenCodeMessage(
  transaction: DatabaseTransaction,
  input: StructuredProgressInput,
): Promise<boolean> {
  const message = readRunnerOpenCodeMessage(input.event.text);
  if (message === undefined) return false;
  if (message === null) return true;
  const [attempt] = await transaction.query(
    `
    SELECT
        agent_session_attempts.provider,
        agent_opencode_message_usage.attempt_id
    FROM agent_session_attempts
    LEFT JOIN agent_opencode_message_usage
        ON agent_opencode_message_usage.message_id = $message_id
    WHERE agent_session_attempts.attempt_id = $attempt_id;
  `,
    { attempt_id: input.attemptId, message_id: message.id },
  );
  if (!attempt) return true;
  const provider = readTextColumn(attempt, 0, "provider");
  const owner = readNullableTextColumn(attempt, 1, "attempt_id");
  if (provider !== "opencode" && provider !== "openrouter") return true;
  if (owner !== null && owner !== input.attemptId) return true;
  await new OpenCodeUsageRepository({
    ...transaction,
    transaction: async <Result>(
      work: (access: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  }).save({
    ...message,
    attemptId: input.attemptId,
    turn: input.turn ?? 1,
    price: nativeOpenCodePrice(message),
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
  // A model step is stored under its own identity, apart from the turn's counters and its receipt.
  if (
    event.kind === "usage" &&
    (await persistOpenCodeMessage(transaction, input))
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
  const reading = runnerUsageEventSchema.parse(JSON.parse(event.text));
  const { claudeObservation, isInterim, ...usage } = reading;
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
    isPartial: normalized.isPartial || isInterim === true,
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
    ...(claudeObservation
      ? { claudeObservation: ledgerObservation(claudeObservation) }
      : {}),
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
