import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { TERMINAL_CHANNEL } from "@/backend/agents/terminal/TerminalStore";
import { isTerminalProvider } from "@/definition/AgentTerminal";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentTerminalRecord,
  AgentTerminalScreenState,
  NewAgentTerminal,
  TerminalHostStore,
  TerminalNotice,
  TerminalViewStore,
} from "@/backend/agents/terminal/TerminalStore";
import type {
  AgentTerminalInput,
  AgentTerminalSegment,
} from "@/definition/AgentTerminal";

const TERMINAL_COLUMNS = `
    instance_id,
    run_id,
    step_id,
    provider,
    state,
    columns_count,
    rows_count,
    is_alternate_screen,
    screen,
    screen_sequence,
    next_sequence,
    retained_from,
    active_step_id,
    question,
    started_at,
    ended_at,
    updated_at
`;

function readTerminal(row: readonly DatabaseValue[]): AgentTerminalRecord {
  const provider = readTextColumn(row, 3, "provider");
  const state = readTextColumn(row, 4, "state");
  if (
    !isTerminalProvider(provider) ||
    (state !== "running" && state !== "ended")
  )
    throw new Error('Database returned an invalid value for "provider".');
  return {
    instanceId: readTextColumn(row, 0, "instance_id"),
    runId: readTextColumn(row, 1, "run_id"),
    stepId: readTextColumn(row, 2, "step_id"),
    provider,
    state,
    columns: readCountColumn(row, 5, "columns_count"),
    rows: readCountColumn(row, 6, "rows_count"),
    isAlternateScreen: readBooleanColumn(row, 7, "is_alternate_screen"),
    screen: readNullableTextColumn(row, 8, "screen"),
    screenSequence: readCountColumn(row, 9, "screen_sequence"),
    nextSequence: readCountColumn(row, 10, "next_sequence"),
    retainedFrom: readCountColumn(row, 11, "retained_from"),
    activeStepId: readNullableTextColumn(row, 12, "active_step_id"),
    question: readNullableTextColumn(row, 13, "question"),
    startedAt: readTextColumn(row, 14, "started_at"),
    endedAt: readNullableTextColumn(row, 15, "ended_at"),
    updatedAt: readTextColumn(row, 16, "updated_at"),
  };
}

function readSegments(
  rows: readonly (readonly DatabaseValue[])[],
): readonly AgentTerminalSegment[] {
  return rows.map((row) => ({
    sequence: readCountColumn(row, 0, "sequence"),
    chunk: readTextColumn(row, 1, "body"),
  }));
}

function readInput(row: readonly DatabaseValue[]): AgentTerminalInput | null {
  const kind = readTextColumn(row, 0, "kind");
  const body = readTextColumn(row, 1, "body");
  if (kind === "data" || kind === "paste") return { kind, text: body };
  if (kind === "interrupt") return { kind };
  const [columns, rows] = body.split("x").map(Number);
  if (
    kind !== "resize" ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows)
  )
    return null;
  return { kind, columns: columns ?? 0, rows: rows ?? 0 };
}

function inputBody(input: AgentTerminalInput): string {
  if (input.kind === "interrupt") return "";
  if (input.kind === "resize") return `${input.columns}x${input.rows}`;
  return input.text;
}

/** PostgreSQL stores text without U+0000; a terminal draws nothing for it. */
function storable(text: string): string {
  return text.replaceAll("\u0000", "");
}

/**
 * The terminals of plan nodes, their redacted segments and the inputs that
 * wait for their process (PAGE-265).
 *
 * @remarks
 * One process writes the segments of a terminal, one after another, so a
 * segment takes its sequence and is stored in one statement. Every change a
 * viewer or the process waits for is announced on {@link TERMINAL_CHANNEL}
 * with the commit; the payload names the terminal only, never content.
 */
export class AgentTerminalRepository
  implements TerminalHostStore, TerminalViewStore
{
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Stores a new terminal before its process starts. */
  public async open(terminal: NewAgentTerminal): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_plan_terminals (
            instance_id,
            run_id,
            step_id,
            provider,
            state,
            columns_count,
            rows_count,
            active_step_id,
            started_at,
            updated_at
        )
        VALUES (
            $instance_id,
            $run_id,
            $step_id,
            $provider,
            'running',
            $columns_count,
            $rows_count,
            $step_id,
            $started_at,
            $started_at
        );
      `,
      {
        instance_id: terminal.instanceId,
        run_id: terminal.runId,
        step_id: terminal.stepId,
        provider: terminal.provider,
        columns_count: terminal.columns,
        rows_count: terminal.rows,
        started_at: terminal.startedAt,
      },
    );
  }

  /** Appends one segment, numbers it and announces it in one statement. */
  public async append(
    instanceId: string,
    body: string,
  ): Promise<number | null> {
    const text = storable(body);
    const rows = await this.database.query(
      `
        WITH terminal AS (
            UPDATE agent_plan_terminals
            SET
                next_sequence = next_sequence + 1,
                stored_characters = stored_characters + $length,
                updated_at = $now
            WHERE instance_id = $instance_id
                AND state = 'running'
            RETURNING next_sequence - 1 AS segment_sequence
        ),
        inserted AS (
            INSERT INTO agent_plan_terminal_segments (
                instance_id,
                "sequence",
                body,
                created_at
            )
            SELECT
                $instance_id,
                terminal.segment_sequence,
                $body,
                $now
            FROM terminal
            RETURNING "sequence"
        )
        SELECT
            inserted."sequence",
            pg_notify($channel, $payload)
        FROM inserted;
      `,
      {
        instance_id: instanceId,
        body: text,
        length: text.length,
        now: new Date().toISOString(),
        channel: TERMINAL_CHANNEL,
        payload: notice("output", instanceId),
      },
    );
    const row = rows[0];
    return row ? readCountColumn(row, 0, "sequence") : null;
  }

  /** Removes the oldest segments until the stored output fits the limit. */
  public async retain(instanceId: string, limit: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          SELECT
              "sequence",
              SUM(length(body)) OVER (ORDER BY "sequence" DESC) AS newer_characters
          FROM agent_plan_terminal_segments
          WHERE instance_id = $instance_id
          ORDER BY "sequence" DESC;
        `,
        { instance_id: instanceId },
      );
      const firstDropped = rows.find(
        (row) => readCountColumn(row, 1, "newer_characters") > limit,
      );
      if (!firstDropped) return;
      const kept = readCountColumn(firstDropped, 0, "sequence") + 1;
      await transaction.execute(
        `
          DELETE FROM agent_plan_terminal_segments
          WHERE instance_id = $instance_id
              AND "sequence" < $kept;
        `,
        { instance_id: instanceId, kept },
      );
      await transaction.execute(
        `
          UPDATE agent_plan_terminals
          SET
              retained_from = $kept,
              stored_characters = (
                  SELECT COALESCE(SUM(length(body)), 0)
                  FROM agent_plan_terminal_segments
                  WHERE instance_id = $instance_id
              )
          WHERE instance_id = $instance_id;
        `,
        { instance_id: instanceId, kept },
      );
    });
  }

  /** Stores the screen up to a segment, for viewers of a full-screen CLI. */
  public async saveScreen(
    instanceId: string,
    screen: AgentTerminalScreenState,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_plan_terminals
        SET
            screen = $screen,
            screen_sequence = $screen_sequence,
            is_alternate_screen = $is_alternate_screen,
            columns_count = $columns_count,
            rows_count = $rows_count,
            updated_at = $now
        WHERE instance_id = $instance_id;
      `,
      {
        instance_id: instanceId,
        screen: storable(screen.screen),
        screen_sequence: screen.sequence,
        is_alternate_screen: screen.isAlternateScreen,
        columns_count: screen.columns,
        rows_count: screen.rows,
        now: new Date().toISOString(),
      },
    );
  }

  /** Marks the node whose turn runs now and tells the viewers. */
  public async activate(instanceId: string, stepId: string): Promise<void> {
    await this.updateAndNotify(instanceId, "active_step_id = $value", stepId);
  }

  /** Records the open question that failed the node. */
  public async question(instanceId: string, question: string): Promise<void> {
    await this.updateAndNotify(
      instanceId,
      "question = $value",
      storable(question).slice(0, 4_000),
    );
  }

  /** Ends the terminal; it takes no further input. */
  public async end(instanceId: string, endedAt: string): Promise<void> {
    await this.updateAndNotify(
      instanceId,
      "state = 'ended', ended_at = $value",
      endedAt,
    );
  }

  /** Takes the waiting inputs of a terminal, oldest first. */
  public async takeInputs(
    instanceId: string,
  ): Promise<readonly AgentTerminalInput[]> {
    const rows = await this.database.query(
      `
        WITH taken AS (
            DELETE FROM agent_plan_terminal_inputs
            WHERE instance_id = $instance_id
            RETURNING
                id,
                kind,
                body
        )
        SELECT
            kind,
            body
        FROM taken
        ORDER BY id;
      `,
      { instance_id: instanceId },
    );
    return rows
      .map(readInput)
      .filter((input): input is AgentTerminalInput => input !== null);
  }

  /** The stored terminal of one process. */
  public async find(instanceId: string): Promise<AgentTerminalRecord | null> {
    const rows = await this.database.query(
      `
        SELECT ${TERMINAL_COLUMNS}
        FROM agent_plan_terminals
        WHERE instance_id = $instance_id;
      `,
      { instance_id: instanceId },
    );
    const row = rows[0];
    return row ? readTerminal(row) : null;
  }

  /** Segments after a cursor, oldest first, up to about the given size. */
  public async after(
    instanceId: string,
    after: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]> {
    const rows = await this.database.query(
      `
        SELECT
            "sequence",
            body
        FROM (
            SELECT
                "sequence",
                body,
                SUM(length(body)) OVER (ORDER BY "sequence") AS older_characters
            FROM agent_plan_terminal_segments
            WHERE instance_id = $instance_id
                AND "sequence" > $after
        ) ranked
        WHERE older_characters - length(body) < $characters
        ORDER BY "sequence";
      `,
      { instance_id: instanceId, after, characters },
    );
    return readSegments(rows);
  }

  /** The newest segments after a cursor, oldest first. */
  public async latest(
    instanceId: string,
    after: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]> {
    return this.newest(instanceId, { after, before: null, characters });
  }

  /** The newest segments before a sequence, oldest first. */
  public async before(
    instanceId: string,
    before: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]> {
    return this.newest(instanceId, { after: 0, before, characters });
  }

  /** Queues one input for the process of the terminal. */
  public async enqueue(
    instanceId: string,
    userId: string,
    input: AgentTerminalInput,
  ): Promise<void> {
    await this.database.query(
      `
        WITH queued AS (
            INSERT INTO agent_plan_terminal_inputs (
                instance_id,
                user_id,
                kind,
                body,
                created_at
            )
            VALUES (
                $instance_id,
                $user_id,
                $kind,
                $body,
                $now
            )
            RETURNING id
        )
        SELECT pg_notify($channel, $payload)
        FROM queued;
      `,
      {
        instance_id: instanceId,
        user_id: userId,
        kind: input.kind,
        body: storable(inputBody(input)),
        now: new Date().toISOString(),
        channel: TERMINAL_CHANNEL,
        payload: notice("input", instanceId),
      },
    );
  }

  /** Marks a run as one somebody intervened in. */
  public async markManualInput(runId: string, at: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_plan_runs
        SET manual_input_at = $at
        WHERE id = $run_id
            AND manual_input_at IS NULL;
      `,
      { run_id: runId, at },
    );
  }

  /** Deletes every terminal of a run with its segments and waiting inputs. */
  public async removeRun(runId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      for (const table of [
        "agent_plan_terminal_segments",
        "agent_plan_terminal_inputs",
      ])
        await transaction.execute(
          `
            DELETE FROM ${table}
            WHERE instance_id IN (
                SELECT instance_id
                FROM agent_plan_terminals
                WHERE run_id = $run_id
            );
          `,
          { run_id: runId },
        );
      await transaction.execute(
        `
          DELETE FROM agent_plan_terminals
          WHERE run_id = $run_id;
        `,
        { run_id: runId },
      );
    });
  }

  private async newest(
    instanceId: string,
    range: {
      readonly after: number;
      readonly before: number | null;
      readonly characters: number;
    },
  ): Promise<readonly AgentTerminalSegment[]> {
    const rows = await this.database.query(
      `
        SELECT
            "sequence",
            body
        FROM (
            SELECT
                "sequence",
                body,
                SUM(length(body)) OVER (ORDER BY "sequence" DESC) AS newer_characters
            FROM agent_plan_terminal_segments
            WHERE instance_id = $instance_id
                AND "sequence" > $after
                AND ($before < 0 OR "sequence" < $before)
        ) ranked
        WHERE newer_characters - length(body) < $characters
        ORDER BY "sequence";
      `,
      {
        instance_id: instanceId,
        after: range.after,
        before: range.before ?? -1,
        characters: range.characters,
      },
    );
    return readSegments(rows);
  }

  private async updateAndNotify(
    instanceId: string,
    assignment: string,
    value: string,
  ): Promise<void> {
    await this.database.query(
      `
        WITH changed AS (
            UPDATE agent_plan_terminals
            SET
                ${assignment},
                updated_at = $now
            WHERE instance_id = $instance_id
            RETURNING instance_id
        )
        SELECT pg_notify($channel, $payload)
        FROM changed;
      `,
      {
        instance_id: instanceId,
        value,
        now: new Date().toISOString(),
        channel: TERMINAL_CHANNEL,
        payload: notice("output", instanceId),
      },
    );
  }
}

function notice(kind: TerminalNotice, instanceId: string): string {
  return `${kind}:${instanceId}`;
}
