import { readAgentParameterValue } from "@/backend/agents/AgentConfigurationInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  readBooleanColumn,
  readCountColumn,
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_INVOCATION_STATES } from "@/definition/AgentPlanJump";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
  AgentPlanHandoverState,
  AgentPlanInvocationState,
  AgentPlanJumpWait,
  AgentPlanJumpWorkspace,
} from "@/definition/AgentPlanJump";

/** The interface of the target entry as it was when the call was made; later edits never change it. */
export interface AgentPlanInvocationInterface {
  readonly inputs: readonly AgentPlanEntryInput[];
  readonly returns: readonly AgentPlanEntryReturn[];
}

/** What a decided call hands back to its caller: named values, never a snapshot. */
export interface AgentPlanInvocationOutcome {
  readonly values: Readonly<Record<string, AgentParameterValue>>;
}

/** Whether the run of the target was created, is still due or will never be created. */
export type AgentPlanInvocationStart = "pending" | "started" | "cancelled";

/** One call of the register. */
export interface AgentPlanInvocationRecord {
  readonly id: string;
  readonly sourcePlanId: string;
  readonly sourceRunId: string;
  readonly sourceNodeId: string;
  readonly activation: number;
  readonly iteration: number | null;
  readonly activationKey: string;
  /** The account that executes the call: the executor of the calling run. */
  readonly userId: string;
  readonly targetPlanId: string;
  readonly targetRevision: number;
  readonly entryNodeId: string;
  readonly targetRunId: string | null;
  readonly targetStatus: string | null;
  readonly inputs: Readonly<Record<string, AgentParameterValue>>;
  readonly contract: AgentPlanInvocationInterface;
  readonly wait: AgentPlanJumpWait;
  readonly signalName: string | null;
  readonly workspace: AgentPlanJumpWorkspace;
  readonly handover: AgentPlanHandoverState;
  readonly handoverKeys: readonly string[];
  readonly start: AgentPlanInvocationStart;
  /** The target no longer belongs to the caller: stopping the caller leaves it alone. */
  readonly isDetached: boolean;
  readonly deadlineAt: string | null;
  readonly state: AgentPlanInvocationState;
  readonly failureReason: string | null;
  readonly outcome: AgentPlanInvocationOutcome | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** What a new call is made of. */
export type NewAgentPlanInvocation = Pick<
  AgentPlanInvocationRecord,
  | "id"
  | "sourcePlanId"
  | "sourceRunId"
  | "sourceNodeId"
  | "activation"
  | "iteration"
  | "activationKey"
  | "userId"
  | "targetPlanId"
  | "targetRevision"
  | "entryNodeId"
  | "inputs"
  | "contract"
  | "wait"
  | "signalName"
  | "workspace"
  | "deadlineAt"
>;

/** How a call is decided. */
export interface AgentPlanInvocationDecision {
  readonly state: Extract<
    AgentPlanInvocationState,
    "succeeded" | "failed" | "timed_out" | "cancelled" | "signalled"
  >;
  readonly reason: string | null;
  readonly outcome: AgentPlanInvocationOutcome | null;
}

/** An accepted signal of a call. */
export interface AgentPlanInvocationSignal {
  readonly name: string;
  readonly payload: AgentParameterValue | null;
  readonly acceptedAt: string;
}

type Queryable = Pick<DatabaseTransaction, "query" | "execute">;

const COLUMNS = `
    id,
    source_plan_id,
    source_run_id,
    source_node_id,
    activation,
    iteration,
    activation_key,
    user_id,
    target_plan_id,
    target_revision,
    entry_node_id,
    target_run_id,
    target_status,
    inputs_json,
    interface_json,
    wait_mode,
    signal_name,
    workspace_mode,
    handover_state,
    handover_keys_json,
    start_state,
    is_detached,
    deadline_at,
    state,
    failure_reason,
    outcome_json,
    created_at,
    decided_at
`;

function readValues(
  text: string,
): Readonly<Record<string, AgentParameterValue>> {
  const parsed = readAgentObject(JSON.parse(text));
  return Object.fromEntries(
    Object.entries(parsed).map(([name, value]) => [
      name,
      readAgentParameterValue(value),
    ]),
  );
}

function readContract(text: string): AgentPlanInvocationInterface {
  const parsed = readAgentObject(JSON.parse(text));
  // Written by Pages from a validated plan; an empty object marks a call without an interface.
  return {
    inputs: Array.isArray(parsed.inputs)
      ? (parsed.inputs as readonly AgentPlanEntryInput[])
      : [],
    returns: Array.isArray(parsed.returns)
      ? (parsed.returns as readonly AgentPlanEntryReturn[])
      : [],
  };
}

function readOutcome(
  text: string | null,
): AgentPlanInvocationOutcome | null {
  if (text === null) return null;
  const parsed = readAgentObject(JSON.parse(text));
  return { values: readValues(JSON.stringify(parsed.values ?? {})) };
}

function readState(value: DatabaseValue | undefined): AgentPlanInvocationState {
  const found = PLAN_INVOCATION_STATES.find((state) => state === value);
  if (!found) throw new Error("Database returned an invalid call state.");
  return found;
}

function readStart(value: DatabaseValue | undefined): AgentPlanInvocationStart {
  if (value === "pending" || value === "started" || value === "cancelled")
    return value;
  throw new Error("Database returned an invalid call start state.");
}

function readHandover(
  value: DatabaseValue | undefined,
): AgentPlanHandoverState {
  if (value === "none" || value === "handed_over" || value === "returned")
    return value;
  throw new Error("Database returned an invalid handover state.");
}

function readWait(value: DatabaseValue | undefined): AgentPlanJumpWait {
  if (value === "continue" || value === "completion" || value === "signal")
    return value;
  throw new Error("Database returned an invalid call wait.");
}

function toRecord(row: readonly DatabaseValue[]): AgentPlanInvocationRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    sourcePlanId: readTextColumn(row, 1, "source_plan_id"),
    sourceRunId: readTextColumn(row, 2, "source_run_id"),
    sourceNodeId: readTextColumn(row, 3, "source_node_id"),
    activation: readCountColumn(row, 4, "activation"),
    iteration: readNullableCountColumn(row, 5, "iteration"),
    activationKey: readTextColumn(row, 6, "activation_key"),
    userId: readTextColumn(row, 7, "user_id"),
    targetPlanId: readTextColumn(row, 8, "target_plan_id"),
    targetRevision: readCountColumn(row, 9, "target_revision"),
    entryNodeId: readTextColumn(row, 10, "entry_node_id"),
    targetRunId: readNullableTextColumn(row, 11, "target_run_id"),
    targetStatus: readNullableTextColumn(row, 12, "target_status"),
    inputs: readValues(readTextColumn(row, 13, "inputs_json")),
    contract: readContract(readTextColumn(row, 14, "interface_json")),
    wait: readWait(row[15]),
    signalName: readNullableTextColumn(row, 16, "signal_name"),
    workspace: row[17] === "shared" ? "shared" : "own",
    handover: readHandover(row[18]),
    handoverKeys: JSON.parse(
      readTextColumn(row, 19, "handover_keys_json"),
    ) as readonly string[],
    start: readStart(row[20]),
    isDetached: readBooleanColumn(row, 21, "is_detached"),
    deadlineAt: readNullableTextColumn(row, 22, "deadline_at"),
    state: readState(row[23]),
    failureReason: readNullableTextColumn(row, 24, "failure_reason"),
    outcome: readOutcome(readNullableTextColumn(row, 25, "outcome_json")),
    createdAt: readTextColumn(row, 26, "created_at"),
    decidedAt: readNullableTextColumn(row, 27, "decided_at"),
  };
}

/**
 * The call register of agent plans.
 * @remarks
 * Every decision is one conditional statement, so two racing writers (a
 * signal and a timeout, a result and a stop) can never both win: the loser
 * finds the call decided and changes nothing.
 */
export class AgentPlanInvocationRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /**
   * Stores a call, or returns the one that already exists for this activation.
   * @returns The call and whether this request made it.
   */
  public async create(
    input: NewAgentPlanInvocation,
    now: string,
  ): Promise<{ record: AgentPlanInvocationRecord; isNew: boolean }> {
    // A call that goes on at once is decided by its acceptance; it only waits for its target to start.
    const isContinue = input.wait === "continue";
    const [created] = await this.database.query(
      `
      INSERT INTO agent_plan_invocations (
          id,
          source_plan_id,
          source_run_id,
          source_node_id,
          activation,
          iteration,
          activation_key,
          user_id,
          target_plan_id,
          target_revision,
          entry_node_id,
          inputs_json,
          interface_json,
          wait_mode,
          signal_name,
          workspace_mode,
          is_detached,
          deadline_at,
          state,
          created_at,
          updated_at,
          decided_at
      ) VALUES (
          $id,
          $source_plan_id,
          $source_run_id,
          $source_node_id,
          $activation,
          $iteration,
          $activation_key,
          $user_id,
          $target_plan_id,
          $target_revision,
          $entry_node_id,
          $inputs_json,
          $interface_json,
          $wait_mode,
          $signal_name,
          $workspace_mode,
          $is_detached,
          $deadline_at,
          $state,
          $now,
          $now,
          $decided_at
      )
      ON CONFLICT (source_run_id, source_node_id, activation_key) DO NOTHING
      RETURNING id;
    `,
      {
        id: input.id,
        source_plan_id: input.sourcePlanId,
        source_run_id: input.sourceRunId,
        source_node_id: input.sourceNodeId,
        activation: input.activation,
        iteration: input.iteration,
        activation_key: input.activationKey,
        user_id: input.userId,
        target_plan_id: input.targetPlanId,
        target_revision: input.targetRevision,
        entry_node_id: input.entryNodeId,
        inputs_json: JSON.stringify(input.inputs),
        interface_json: JSON.stringify(input.contract),
        wait_mode: input.wait,
        signal_name: input.signalName,
        workspace_mode: input.workspace,
        is_detached: isContinue ? 1 : 0,
        deadline_at: input.deadlineAt,
        state: isContinue ? "accepted" : "queued",
        decided_at: isContinue ? now : null,
        now,
      },
    );
    const record = await this.findBySource(
      input.sourceRunId,
      input.sourceNodeId,
      input.activationKey,
    );
    if (!record) throw new AgentError("plan_jump_invocation_missing");
    return { record, isNew: created !== undefined };
  }

  /** Reads one call by its identity. */
  public async find(id: string): Promise<AgentPlanInvocationRecord | null> {
    return this.one(this.database, "WHERE id = $id", { id });
  }

  /** Reads the call of one activation of a Jump node. */
  public async findBySource(
    sourceRunId: string,
    sourceNodeId: string,
    activationKey: string,
  ): Promise<AgentPlanInvocationRecord | null> {
    return this.one(
      this.database,
      `
      WHERE source_run_id = $source_run_id
          AND source_node_id = $source_node_id
          AND activation_key = $activation_key
    `,
      {
        source_run_id: sourceRunId,
        source_node_id: sourceNodeId,
        activation_key: activationKey,
      },
    );
  }

  /** Reads the call a run was started by, for the signals and the end of that run. */
  public async findByTargetRun(
    runId: string,
  ): Promise<AgentPlanInvocationRecord | null> {
    return this.one(this.database, "WHERE target_run_id = $run_id", {
      run_id: runId,
    });
  }

  /** Every call a run made, oldest first. */
  public async forSourceRun(
    runId: string,
  ): Promise<readonly AgentPlanInvocationRecord[]> {
    return this.many("WHERE source_run_id = $run_id", { run_id: runId });
  }

  /** The calls whose target run still has to be created, oldest first. */
  public async pendingStarts(): Promise<readonly AgentPlanInvocationRecord[]> {
    return this.many("WHERE start_state = 'pending'", {});
  }

  /** The calls nobody has decided yet, oldest first. */
  public async undecided(): Promise<readonly AgentPlanInvocationRecord[]> {
    return this.many("WHERE decided_at IS NULL", {});
  }

  /** Calls that were decided against their caller while the called run may still run. */
  public async openTargets(): Promise<readonly AgentPlanInvocationRecord[]> {
    return this.many(
      `
      WHERE decided_at IS NOT NULL
          AND state IN ('timed_out', 'failed', 'cancelled')
          AND is_detached = 0
          AND target_run_id IS NOT NULL
          AND target_status IS NULL
    `,
      {},
    );
  }

  /**
   * Records, inside the transaction that creates the target run, that the run exists.
   * @throws {AgentError} `plan_jump_start_conflict` when the call already has a
   * run or will never get one; the transaction then rolls back and no second
   * run exists.
   */
  public async begin(
    transaction: Queryable,
    id: string,
    targetRunId: string,
    now: string,
  ): Promise<void> {
    const rows = await transaction.query(
      `
      UPDATE agent_plan_invocations
      SET start_state = 'started',
          target_run_id = $run_id,
          state = CASE WHEN decided_at IS NULL THEN 'running' ELSE state END,
          updated_at = $now
      WHERE id = $id
          AND start_state = 'pending'
      RETURNING id;
    `,
      { id, run_id: targetRunId, now },
    );
    if (rows.length === 0) throw new AgentError("plan_jump_start_conflict");
  }

  /** Withdraws the start of a call whose target run was never created. */
  public async cancelStart(id: string, now: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_plan_invocations
      SET start_state = 'cancelled',
          updated_at = $now
      WHERE id = $id
          AND start_state = 'pending';
    `,
      { id, now },
    );
  }

  /**
   * Decides a call, once.
   * @returns Whether this request decided it; `false` when it was decided before.
   * @remarks
   * A call whose awaited signal was accepted can only be decided by that signal,
   * or cancelled; a failure that raced with the signal never replaces it.
   */
  public async decide(
    id: string,
    decision: AgentPlanInvocationDecision,
    now: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE agent_plan_invocations
      SET state = $state,
          failure_reason = $reason,
          outcome_json = $outcome,
          decided_at = $now,
          updated_at = $now,
          is_detached = CASE WHEN $state = 'signalled' THEN 1 ELSE is_detached END,
          start_state = CASE
              WHEN start_state = 'pending' AND $state <> 'signalled' THEN 'cancelled'
              ELSE start_state
          END
      WHERE id = $id
          AND decided_at IS NULL
          AND (
              signal_accepted_at IS NULL
              OR $state IN ('signalled', 'cancelled')
          )
      RETURNING id;
    `,
      {
        id,
        state: decision.state,
        reason: decision.reason,
        outcome: decision.outcome ? JSON.stringify(decision.outcome) : null,
        now,
      },
    );
    return rows.length > 0;
  }

  /**
   * Decides the call as timed out, unless a signal was accepted in time.
   * @remarks
   * A signal is only accepted before the deadline and marks the call row, so
   * an accepted signal always beats the timeout, however late this runs.
   */
  public async decideTimeout(id: string, now: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE agent_plan_invocations
      SET state = 'timed_out',
          failure_reason = 'plan_jump_timeout',
          decided_at = $now,
          updated_at = $now,
          start_state = CASE
              WHEN start_state = 'pending' THEN 'cancelled'
              ELSE start_state
          END
      WHERE id = $id
          AND decided_at IS NULL
          AND signal_accepted_at IS NULL
          AND deadline_at IS NOT NULL
          AND deadline_at <= $now
      RETURNING id;
    `,
      { id, now },
    );
    return rows.length > 0;
  }

  /**
   * Accepts a signal of a called run.
   * @param id - The call the signal belongs to.
   * @param senderRunId - The authenticated run that sends it; it has to be the target run of the call.
   * @returns Whether this signal is the first of its name and was accepted.
   * @remarks
   * A decided call and a call past its deadline accept nothing, so a late
   * signal never wakes the caller. The call row is locked while the signal is
   * stored, so a racing decision either sees the signal or finds the call
   * decided before it. A repeated signal of the same name changes nothing.
   */
  public async acceptSignal(
    id: string,
    senderRunId: string,
    signal: {
      readonly name: string;
      readonly payload: AgentParameterValue | null;
    },
    now: string,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [call] = await transaction.query(
        `
        SELECT signal_name
        FROM agent_plan_invocations
        WHERE id = $id
            AND target_run_id = $run_id
            AND decided_at IS NULL
            AND (deadline_at IS NULL OR deadline_at > $now)
        FOR UPDATE;
      `,
        { id, run_id: senderRunId, now },
      );
      if (!call) return false;
      const stored = await transaction.query(
        `
        INSERT INTO agent_plan_invocation_signals (
            invocation_id,
            name,
            payload_json,
            accepted_at
        ) VALUES ($id, $name, $payload, $now)
        ON CONFLICT (invocation_id, name) DO NOTHING
        RETURNING name;
      `,
        {
          id,
          name: signal.name,
          payload: signal.payload ? JSON.stringify(signal.payload) : null,
          now,
        },
      );
      if (stored.length === 0) return false;
      if (call[0] === signal.name)
        await transaction.execute(
          `
          UPDATE agent_plan_invocations
          SET signal_accepted_at = $now,
              updated_at = $now
          WHERE id = $id;
        `,
          { id, now },
        );
      return true;
    });
  }

  /** The accepted signal of one name, if any. */
  public async signal(
    id: string,
    name: string,
  ): Promise<AgentPlanInvocationSignal | null> {
    const [row] = await this.database.query(
      `
      SELECT
          name,
          payload_json,
          accepted_at
      FROM agent_plan_invocation_signals
      WHERE invocation_id = $id
          AND name = $name;
    `,
      { id, name },
    );
    if (!row) return null;
    const payload = readNullableTextColumn(row, 1, "payload_json");
    return {
      name: readTextColumn(row, 0, "name"),
      payload: payload === null ? null : readAgentParameterValue(JSON.parse(payload)),
      acceptedAt: readTextColumn(row, 2, "accepted_at"),
    };
  }

  /** Remembers how the target run stands, so the caller's card can show it. */
  public async recordTargetStatus(
    runId: string,
    status: string,
    now: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_plan_invocations
      SET target_status = $status,
          updated_at = $now
      WHERE target_run_id = $run_id;
    `,
      { run_id: runId, status, now },
    );
  }

  /** Gives up the start of a call that was already decided, such as one that went on at once. */
  public async failStart(id: string, reason: string, now: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_plan_invocations
      SET start_state = 'cancelled',
          failure_reason = $reason,
          updated_at = $now
      WHERE id = $id
          AND start_state = 'pending';
    `,
      { id, reason, now },
    );
  }

  /** Names an open cleanup as the reason of a call that was cancelled or timed out. */
  public async recordCleanupOpen(id: string, now: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_plan_invocations
      SET failure_reason = 'plan_jump_cleanup_open',
          updated_at = $now
      WHERE id = $id
          AND state IN ('cancelled', 'timed_out', 'failed');
    `,
      { id, now },
    );
  }

  /** Marks that the target no longer belongs to its caller. */
  public async detach(id: string, now: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_plan_invocations
      SET is_detached = 1,
          updated_at = $now
      WHERE id = $id;
    `,
      { id, now },
    );
  }

  /** The runs a run waits for through its undecided calls that wait. */
  public async waitingTargets(runId: string): Promise<readonly string[]> {
    const rows = await this.database.query(
      `
      SELECT target_run_id
      FROM agent_plan_invocations
      WHERE source_run_id = $run_id
          AND decided_at IS NULL
          AND wait_mode <> 'continue'
          AND target_run_id IS NOT NULL;
    `,
      { run_id: runId },
    );
    return rows.map((row) => readTextColumn(row, 0, "target_run_id"));
  }

  /** Whether a plan has a run that has not ended; only one such run exists per plan. */
  public async hasActiveRun(planId: string): Promise<boolean> {
    const [row] = await this.database.query(
      `
      SELECT 1
      FROM agent_plan_runs
      WHERE plan_id = $plan_id
          AND status IN ('running', 'pausing', 'paused', 'stopping')
      LIMIT 1;
    `,
      { plan_id: planId },
    );
    return row !== undefined;
  }

  /** Whether a run still holds a writing resource, which proves its cleanup is not finished. */
  public async hasReservation(runId: string): Promise<boolean> {
    const [row] = await this.database.query(
      `
      SELECT 1
      FROM agent_plan_workspace_locks
      WHERE run_id = $run_id
      LIMIT 1;
    `,
      { run_id: runId },
    );
    return row !== undefined;
  }

  private async one(
    source: Pick<Queryable, "query">,
    condition: string,
    parameters: Readonly<Record<string, string | number>>,
  ): Promise<AgentPlanInvocationRecord | null> {
    const [row] = await source.query(
      `
      SELECT ${COLUMNS}
      FROM agent_plan_invocations
      ${condition}
      LIMIT 1;
    `,
      parameters,
    );
    return row ? toRecord(row) : null;
  }

  private async many(
    condition: string,
    parameters: Readonly<Record<string, string | number>>,
  ): Promise<readonly AgentPlanInvocationRecord[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM agent_plan_invocations
      ${condition}
      ORDER BY creation_order;
    `,
      parameters,
    );
    return rows.map(toRecord);
  }
}
