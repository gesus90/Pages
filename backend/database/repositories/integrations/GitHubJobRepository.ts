import { randomUUID } from "node:crypto";

import { readTextColumn, readCountColumn } from "@/backend/database/RowValue";
import {
  gitHubCommandSchema,
  gitHubResultSchema,
} from "@/definition/IntegrationJobs";

import type { Database } from "@/backend/database/Database";
import type {
  GitHubCommand,
  GitHubJobResult,
} from "@/definition/IntegrationJobs";

/** A claimed intent; only the database owner may execute it. */
export interface GitHubJob {
  readonly id: string;
  readonly command: GitHubCommand;
  readonly attempts: number;
}

/** Persistence of GitHub intents, replies and crash recovery. */
export class GitHubJobRepository {
  private readonly database: Database;

  /** Uses the instance database, shared by API producers and the selected consumer. */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Stores intent before any external work; repeated scheduled work shares one pending row. */
  public async enqueue(
    command: GitHubCommand,
    deduplicationKey: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    const rows = await this.database.query(
      `
      INSERT INTO integration_github_jobs (
          id,
          command_json,
          deduplication_key
      )
      VALUES ($id, $command, $deduplication_key)
      ON CONFLICT (deduplication_key) WHERE state IN ('pending', 'running')
      DO UPDATE SET deduplication_key = EXCLUDED.deduplication_key
      RETURNING id;
    `,
      {
        id,
        command: JSON.stringify(gitHubCommandSchema.parse(command)),
        deduplication_key: deduplicationKey,
      },
    );
    return readTextColumn(rows[0] ?? [], 0, "id");
  }

  /** Called only after acquiring exclusive session ownership: the previous consumer is gone. */
  public async recover(): Promise<void> {
    // Import creates a local task before linking it. Never blindly repeat that ambiguous window.
    await this.database.execute(`
      UPDATE integration_github_jobs
      SET state = CASE WHEN command_json::jsonb ->> 'operation' = 'import'
              THEN 'uncertain' ELSE 'pending' END,
          updated_at = clock_timestamp()
      WHERE state = 'running';
    `);
  }

  /** Atomically claims one due job without holding a transaction across network calls. */
  public async claim(): Promise<GitHubJob | null> {
    const rows = await this.database.query(`
      UPDATE integration_github_jobs
      SET state = 'running',
          attempts = attempts + 1,
          updated_at = clock_timestamp()
      WHERE id = (
          SELECT id
          FROM integration_github_jobs
          WHERE state = 'pending'
              AND available_at <= clock_timestamp()
          ORDER BY created_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
      )
      RETURNING
          id,
          command_json,
          attempts;
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      command: gitHubCommandSchema.parse(
        JSON.parse(readTextColumn(row, 1, "command_json")),
      ),
      attempts: readCountColumn(row, 2, "attempts"),
    };
  }

  /** Stores a sanitized reply before the caller can observe completion. */
  public async finish(id: string, result: GitHubJobResult): Promise<void> {
    await this.database.execute(
      `
      UPDATE integration_github_jobs
      SET state = $state,
          result_json = $result,
          updated_at = clock_timestamp()
      WHERE id = $id
          AND state = 'running';
    `,
      {
        id,
        state: result.kind === "error" ? "failed" : "done",
        result: JSON.stringify(result),
      },
    );
  }

  /** Retries reconcilable failures with a persisted delay, without losing the job on restart. */
  public async retry(id: string, delaySeconds: number): Promise<void> {
    await this.database.execute(
      `
      UPDATE integration_github_jobs
      SET state = 'pending',
          available_at = clock_timestamp() + $seconds * INTERVAL '1 second',
          updated_at = clock_timestamp()
      WHERE id = $id
          AND state = 'running';
    `,
      { id, seconds: delaySeconds },
    );
  }

  /** Reads a bounded, content-free reply. Pending work remains durable if its caller disconnects. */
  public async result(id: string): Promise<GitHubJobResult | null> {
    const rows = await this.database.query(
      `
      SELECT
          state,
          result_json
      FROM integration_github_jobs
      WHERE id = $id;
    `,
      { id },
    );
    const row = rows[0];
    if (!row) throw new Error("GitHub job is unavailable.");
    if (row[0] === "uncertain")
      return { kind: "error", code: "integration_outcome_uncertain" };
    if (row[1] === null) return null;
    return gitHubResultSchema.parse(
      JSON.parse(readTextColumn(row, 1, "result_json")),
    );
  }

  /** Keeps terminal replies for seven days; uncertain jobs require explicit operator reconciliation. */
  public async prune(): Promise<void> {
    await this.database.execute(`
      DELETE FROM integration_github_jobs
      WHERE state IN ('done', 'failed')
          AND updated_at < clock_timestamp() - INTERVAL '7 days';
    `);
  }
}
