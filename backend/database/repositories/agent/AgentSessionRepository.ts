import { AgentSessionEventRepository } from "./AgentSessionEventRepository";
import {
  ATTEMPT_COLUMNS,
  MESSAGE_COLUMNS,
  USAGE_COLUMNS,
  readAttemptRow,
  readMessageRow,
  readUsageRow,
} from "./AgentSessionRows";

import type { SqlParameters } from "@/backend/database/Database";
import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
  NewAgentSessionEvent,
  StoredSessionEvents,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type {
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
  AgentSessionGitState,
  AgentSessionMessage,
  AgentSessionMessageStatus,
  AgentSessionTurnUsage,
} from "@/definition/AgentSessionJournal";

function gitReference(git: AgentSessionGitState | undefined): string | null {
  if (git?.state === "branch") return git.branch;
  if (git?.state === "detached") return git.commit;
  return null;
}

/** The parameters of an attempt's row, in the names of its columns. */
function attemptParameters(attempt: AgentSessionAttemptRecord): SqlParameters {
  const { key, context, confirmedModel, confirmedReasoning, workspace } =
    attempt;
  return {
    attempt_id: key.attemptId,
    plan_id: key.planId,
    run_id: key.runId,
    step_id: key.stepId,
    user_id: attempt.userId,
    provider: attempt.provider,
    instance_id: attempt.instanceId,
    group_id: attempt.groupId,
    state: attempt.state,
    context_used: context.contextUsed,
    context_limit: context.contextLimit,
    context_source: context.source,
    context_at: context.reportedAt,
    cost_amount: context.cost?.amount ?? null,
    cost_currency: context.cost?.currency ?? null,
    confirmed_model: confirmedModel.value,
    confirmed_model_source: confirmedModel.source,
    confirmed_model_at: confirmedModel.reportedAt,
    confirmed_reasoning: confirmedReasoning.value,
    confirmed_reasoning_source: confirmedReasoning.source,
    confirmed_reasoning_at: confirmedReasoning.reportedAt,
    workspace_directory: workspace?.directory ?? null,
    git_state: workspace?.git.state ?? null,
    git_reference: gitReference(workspace?.git),
    workspace_at: workspace?.checkedAt ?? null,
    updated_at: attempt.updatedAt,
  };
}

/** The PageAgentCLI tables: attempts, events, turn usage and instructions. */
export class AgentSessionRepository implements AgentSessionStore {
  private readonly database: AgentSessionDatabase;
  private readonly events: AgentSessionEventRepository;

  public constructor(database: AgentSessionDatabase) {
    this.database = database;
    this.events = new AgentSessionEventRepository(database);
  }

  /** Stores the state of an attempt; the event sequence is kept as it is. */
  public async saveAttempt(attempt: AgentSessionAttemptRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_session_attempts (
          attempt_id,
          plan_id,
          run_id,
          step_id,
          user_id,
          provider,
          instance_id,
          group_id,
          state,
          context_used,
          context_limit,
          context_source,
          context_at,
          confirmed_model,
          confirmed_model_source,
          confirmed_model_at,
          confirmed_reasoning,
          confirmed_reasoning_source,
          confirmed_reasoning_at,
          workspace_directory,
          git_state,
          git_reference,
          workspace_at,
          updated_at,
          cost_amount,
          cost_currency
      )
      VALUES (
          $attempt_id,
          $plan_id,
          $run_id,
          $step_id,
          $user_id,
          $provider,
          $instance_id,
          $group_id,
          $state,
          $context_used,
          $context_limit,
          $context_source,
          $context_at,
          $confirmed_model,
          $confirmed_model_source,
          $confirmed_model_at,
          $confirmed_reasoning,
          $confirmed_reasoning_source,
          $confirmed_reasoning_at,
          $workspace_directory,
          $git_state,
          $git_reference,
          $workspace_at,
          $updated_at,
          $cost_amount,
          $cost_currency
      )
      ON CONFLICT (attempt_id) DO UPDATE SET
          state = excluded.state,
          context_used = excluded.context_used,
          context_limit = excluded.context_limit,
          context_source = excluded.context_source,
          context_at = excluded.context_at,
          confirmed_model = excluded.confirmed_model,
          confirmed_model_source = excluded.confirmed_model_source,
          confirmed_model_at = excluded.confirmed_model_at,
          confirmed_reasoning = excluded.confirmed_reasoning,
          confirmed_reasoning_source = excluded.confirmed_reasoning_source,
          confirmed_reasoning_at = excluded.confirmed_reasoning_at,
          workspace_directory = excluded.workspace_directory,
          git_state = excluded.git_state,
          git_reference = excluded.git_reference,
          workspace_at = excluded.workspace_at,
          updated_at = excluded.updated_at,
          cost_amount = excluded.cost_amount,
          cost_currency = excluded.cost_currency;
    `,
      attemptParameters(attempt),
    );
  }

  /** Reads the state of an attempt; the caller authorizes it against its run. */
  public async findAttempt(
    attemptId: string,
  ): Promise<AgentSessionAttemptRecord | null> {
    const [row] = await this.database.query(
      `
      SELECT ${ATTEMPT_COLUMNS}
      FROM agent_session_attempts
      WHERE attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId },
    );
    return row ? readAttemptRow(row) : null;
  }

  /** Assigns sequences, publishes synchronized files and applies the existing event retention. */
  public async appendEvents(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
    retain: number,
  ): Promise<readonly AgentSessionEvent[]> {
    return this.events.appendEvents(attemptId, events, retain);
  }

  /** Reads retained events in either storage form with integrity verification. */
  public async readEvents(
    attemptId: string,
    after: number,
    limit: number,
  ): Promise<StoredSessionEvents> {
    return this.events.readEvents(attemptId, after, limit);
  }

  /** Reads the immutable journal or the retained legacy event history. */
  public async readWindow(
    attemptId: string,
    window: AgentSessionHistoryWindow,
  ): Promise<AgentSessionEventPage> {
    return this.events.readWindow(attemptId, window);
  }

  /** Stores a turn's tokens; a second report of the same turn replaces the first. */
  public async saveTurnUsage(usage: AgentSessionTurnUsage): Promise<void> {
    await this.database.execute(
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
          reported_at
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
          $reported_at
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
          reported_at = excluded.reported_at;
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
      },
    );
  }

  /** Reads the turns of every attempt of a run. */
  public async listRunUsage(
    runId: string,
  ): Promise<readonly AgentSessionTurnUsage[]> {
    const rows = await this.database.query(
      `
      SELECT ${USAGE_COLUMNS}
      FROM agent_session_turn_usage
      INNER JOIN agent_session_attempts
          ON agent_session_attempts.attempt_id = agent_session_turn_usage.attempt_id
      WHERE agent_session_attempts.run_id = $run_id
      ORDER BY
          agent_session_turn_usage.attempt_id,
          agent_session_turn_usage.turn;
    `,
      { run_id: runId },
    );
    return rows.map(readUsageRow);
  }

  /** Stores a new instruction. */
  public async saveMessage(message: AgentSessionMessage): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_session_messages (${MESSAGE_COLUMNS})
      VALUES (
          $id,
          $attempt_id,
          $user_id,
          $kind,
          $body,
          $status,
          $created_at,
          $updated_at
      );
    `,
      {
        id: message.id,
        attempt_id: message.attemptId,
        user_id: message.userId,
        kind: message.kind,
        body: message.text,
        status: message.status,
        created_at: message.createdAt,
        updated_at: message.updatedAt,
      },
    );
  }

  /** Changes the status only from an expected one, in one statement. */
  public async updateMessage(
    id: string,
    from: readonly AgentSessionMessageStatus[],
    status: AgentSessionMessageStatus,
  ): Promise<boolean> {
    if (from.length === 0) return false;
    const placeholders = from.map((_, index) => `$from_${index}`).join(", ");
    const rows = await this.database.query(
      `
      UPDATE agent_session_messages
      SET
          status = $status,
          updated_at = $updated_at
      WHERE id = $id
          AND status IN (${placeholders})
      RETURNING id;
    `,
      {
        id,
        status,
        updated_at: new Date().toISOString(),
        ...Object.fromEntries(
          from.map((expected, index) => [`from_${index}`, expected]),
        ),
      },
    );
    return rows.length > 0;
  }

  /** Reads the instructions of an attempt in the order they were sent. */
  public async listMessages(
    attemptId: string,
  ): Promise<readonly AgentSessionMessage[]> {
    const rows = await this.database.query(
      `
      SELECT ${MESSAGE_COLUMNS}
      FROM agent_session_messages
      WHERE attempt_id = $attempt_id
      ORDER BY
          created_at,
          id;
    `,
      { attempt_id: attemptId },
    );
    return rows.map(readMessageRow);
  }

  /** Marks deliveries a stopped server left on the way, in one statement. */
  public async markUncertainDeliveries(): Promise<number> {
    const rows = await this.database.query(
      `
      UPDATE agent_session_messages
      SET
          status = 'uncertain',
          updated_at = $updated_at
      WHERE status = 'delivering'
      RETURNING id;
    `,
      { updated_at: new Date().toISOString() },
    );
    return rows.length;
  }
}
