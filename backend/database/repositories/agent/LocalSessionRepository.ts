import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { localOwnerProofSchema } from "@/backend/agents/local/LocalSessionContracts";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { LocalOwnerProof } from "@/backend/agents/local/LocalSessionContracts";

/** Metadata only: native credentials, transcripts and result bodies stay out of PostgreSQL. */
export interface LocalSessionEntry {
  readonly instanceId: string;
  readonly instanceKey: string;
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly manifestDigest: string;
  readonly proof: LocalOwnerProof | null;
  readonly acknowledgedSequence: number;
  readonly acknowledgedDigest: string;
  readonly checkpointFile: string | null;
  readonly releasedAt: string | null;
}

/** Durable launch intents and import cursors for independently owned local sessions. */
export class LocalSessionRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reserves the native identity before a unit can start. A conflict never launches again. */
  public async create(
    entry: Omit<
      LocalSessionEntry,
      | "proof"
      | "acknowledgedSequence"
      | "acknowledgedDigest"
      | "checkpointFile"
      | "releasedAt"
    >,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_local_session_owners (
          instance_id,
          instance_key,
          run_id,
          step_id,
          attempt_id,
          manifest_digest,
          created_at
      ) VALUES (
          $instance_id,
          $instance_key,
          $run_id,
          $step_id,
          $attempt_id,
          $manifest_digest,
          $created_at
      );
    `,
      {
        instance_id: entry.instanceId,
        instance_key: entry.instanceKey,
        run_id: entry.runId,
        step_id: entry.stepId,
        attempt_id: entry.attemptId,
        manifest_digest: entry.manifestDigest,
        created_at: new Date().toISOString(),
      },
    );
  }

  /** Lists only this configured instance's owners, retaining uncertain evidence for recovery. */
  public async list(
    instanceKey: string,
  ): Promise<readonly LocalSessionEntry[]> {
    const rows = await this.database.query(
      `
      SELECT
          instance_id,
          instance_key,
          run_id,
          step_id,
          attempt_id,
          manifest_digest,
          proof,
          acknowledged_sequence,
          acknowledged_digest,
          checkpoint_file,
          released_at
      FROM agent_local_session_owners
      WHERE instance_key = $instance_key
      ORDER BY created_at, instance_id;
    `,
      { instance_key: instanceKey },
    );
    return rows.map((row) => ({
      instanceId: readTextColumn(row, 0, "instance_id"),
      instanceKey: readTextColumn(row, 1, "instance_key"),
      runId: readTextColumn(row, 2, "run_id"),
      stepId: readTextColumn(row, 3, "step_id"),
      attemptId: readTextColumn(row, 4, "attempt_id"),
      manifestDigest: readTextColumn(row, 5, "manifest_digest"),
      proof:
        row[6] === null
          ? null
          : localOwnerProofSchema.parse(
              JSON.parse(readTextColumn(row, 6, "proof")),
            ),
      acknowledgedSequence: readCountColumn(row, 7, "acknowledged_sequence"),
      acknowledgedDigest: readTextColumn(row, 8, "acknowledged_digest"),
      checkpointFile: readNullableTextColumn(row, 9, "checkpoint_file"),
      releasedAt: readNullableTextColumn(row, 10, "released_at"),
    }));
  }

  /** Stores an independently checked live proof; it cannot change after the first adoption. */
  public async prove(
    instanceId: string,
    proof: LocalOwnerProof,
  ): Promise<void> {
    const encoded = JSON.stringify(proof);
    const rows = await this.database.query(
      `
      UPDATE agent_local_session_owners
      SET proof = $proof
      WHERE instance_id = $instance_id
          AND (proof IS NULL OR proof = $proof)
      RETURNING instance_id;
    `,
      { instance_id: instanceId, proof: encoded },
    );
    if (rows.length !== 1) throw new Error("Local owner proof changed");
  }

  /** Retains the immutable result reference before acknowledging a native turn. */
  public async saveResult(
    instanceId: string,
    turnId: string,
    payloadFile: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_local_session_results (
          instance_id,
          turn_id,
          payload_file
      ) VALUES (
          $instance_id,
          $turn_id,
          $payload_file
      )
      ON CONFLICT (instance_id, turn_id) DO NOTHING;
    `,
      { instance_id: instanceId, turn_id: turnId, payload_file: payloadFile },
    );
  }

  /** Fences an observer from an earlier Pages process before a new importer starts. */
  public async claim(instanceId: string, token: string): Promise<void> {
    await this.database.execute(
      "UPDATE agent_local_session_owners SET importer_token = $token WHERE instance_id = $instance_id;",
      { instance_id: instanceId, token },
    );
  }

  /** Locks and checks the importer fence before any attempt, event or token projection can change. */
  public async requireImporter(
    entry: LocalSessionEntry,
    token: string,
  ): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT instance_id
      FROM agent_local_session_owners
      WHERE instance_id = $instance_id
          AND importer_token = $token
          AND acknowledged_sequence = $sequence
          AND acknowledged_digest = $digest
      FOR UPDATE;
    `,
      {
        instance_id: entry.instanceId,
        token,
        sequence: entry.acknowledgedSequence,
        digest: entry.acknowledgedDigest,
      },
    );
    if (rows.length !== 1) throw new Error("Concurrent local session importer");
  }

  /** Records release only after proven native closeout, complete import and authenticated release. */
  public async released(instanceId: string): Promise<void> {
    await this.database.execute(
      "UPDATE agent_local_session_owners SET released_at = $released_at WHERE instance_id = $instance_id;",
      { instance_id: instanceId, released_at: new Date().toISOString() },
    );
  }

  /** Returns a completed turn without sending its original prompt again. */
  public async result(
    instanceId: string,
    turnId: string,
  ): Promise<string | null> {
    const [row] = await this.database.query(
      `
      SELECT payload_file
      FROM agent_local_session_results
      WHERE instance_id = $instance_id
          AND turn_id = $turn_id;
    `,
      { instance_id: instanceId, turn_id: turnId },
    );
    return row ? readTextColumn(row, 0, "payload_file") : null;
  }

  /** Commits the replay checkpoint before an ACK is sent; a lost ACK only replays idempotent imports. */
  public async acknowledge(
    entry: LocalSessionEntry,
    next: {
      readonly sequence: number;
      readonly digest: string;
      readonly checkpointFile: string;
      readonly token: string;
    },
  ): Promise<void> {
    const rows = await this.database.query(
      `
      UPDATE agent_local_session_owners
      SET
          acknowledged_sequence = $sequence,
          acknowledged_digest = $digest,
          checkpoint_file = $checkpoint_file
      WHERE instance_id = $instance_id
          AND acknowledged_sequence = $previous
          AND importer_token = $token
      RETURNING instance_id;
    `,
      {
        instance_id: entry.instanceId,
        previous: entry.acknowledgedSequence,
        sequence: next.sequence,
        digest: next.digest,
        checkpoint_file: next.checkpointFile,
        token: next.token,
      },
    );
    if (rows.length !== 1) throw new Error("Concurrent local session importer");
  }
}
