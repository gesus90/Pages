import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { RemoteError } from "@/backend/error/RemoteErrors";
import {
  isRemoteAuthMethod,
  isRemoteFailureCode,
} from "@/definition/RemoteConnection";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  RemoteAuthMethod,
  RemoteConnectionCheck,
  RemoteHostKey,
  RemoteTestStage,
} from "@/definition/RemoteConnection";

/** Secrets of a connection as stored: cipher payloads, never clear text. */
export interface RemoteEncryptedSecrets {
  readonly password: string | null;
  readonly privateKey: string | null;
  readonly passphrase: string | null;
}

/** A stored connection; only the service decrypts its secrets, and only for SSH. */
export interface RemoteConnectionRecord {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly departmentId: string;
  readonly hostKey: RemoteHostKey | null;
  /** Normalized absolute directories; empty allows only the SSH user's home. */
  readonly allowedRoots: readonly string[];
  readonly secrets: RemoteEncryptedSecrets;
  readonly lastCheck: RemoteConnectionCheck | null;
  readonly revision: number;
}

const CONNECTION_COLUMNS = `
    id,
    name,
    host,
    port,
    username,
    auth_method,
    department_id,
    host_key_algorithm,
    host_key,
    host_key_fingerprint,
    password_encrypted,
    private_key_encrypted,
    passphrase_encrypted,
    checked_at,
    check_stage,
    check_code,
    revision,
    allowed_roots_json
`;

function readAuthMethod(row: readonly DatabaseValue[]): RemoteAuthMethod {
  const method = readTextColumn(row, 5, "auth_method");
  if (!isRemoteAuthMethod(method))
    throw new Error('Database returned an invalid value for "auth_method".');
  return method;
}

function readHostKey(row: readonly DatabaseValue[]): RemoteHostKey | null {
  const algorithm = readNullableTextColumn(row, 7, "host_key_algorithm");
  const key = readNullableTextColumn(row, 8, "host_key");
  const fingerprint = readNullableTextColumn(row, 9, "host_key_fingerprint");
  if (algorithm === null || key === null || fingerprint === null) return null;
  return { algorithm, key, fingerprint };
}

function isTextList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/**
 * Reads a stored JSON list of directories on a remote machine.
 *
 * @param json - The stored text.
 * @param column - The column it was read from, for the error.
 * @returns The directories.
 * @throws When the text is no list of texts.
 */
export function parseRemoteRoots(
  json: string,
  column: string,
): readonly string[] {
  const roots: unknown = JSON.parse(json);
  if (!isTextList(roots))
    throw new Error(`Database returned an invalid value for "${column}".`);
  return roots;
}

function readAllowedRoots(row: readonly DatabaseValue[]): readonly string[] {
  const json = readNullableTextColumn(row, 17, "allowed_roots_json");
  return json === null ? [] : parseRemoteRoots(json, "allowed_roots_json");
}

function readStage(value: string | null): RemoteTestStage | null {
  if (
    value === "reachability" ||
    value === "host_key" ||
    value === "authentication"
  )
    return value;
  return null;
}

function readCheck(
  row: readonly DatabaseValue[],
): RemoteConnectionCheck | null {
  const checkedAt = readNullableTextColumn(row, 13, "checked_at");
  if (checkedAt === null) return null;
  const code = readNullableTextColumn(row, 15, "check_code");
  return {
    checkedAt,
    stage: readStage(readNullableTextColumn(row, 14, "check_stage")),
    code: isRemoteFailureCode(code) ? code : null,
  };
}

function readConnection(row: readonly DatabaseValue[]): RemoteConnectionRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    host: readTextColumn(row, 2, "host"),
    port: readCountColumn(row, 3, "port"),
    username: readTextColumn(row, 4, "username"),
    authMethod: readAuthMethod(row),
    departmentId: readTextColumn(row, 6, "department_id"),
    hostKey: readHostKey(row),
    allowedRoots: readAllowedRoots(row),
    secrets: {
      password: readNullableTextColumn(row, 10, "password_encrypted"),
      privateKey: readNullableTextColumn(row, 11, "private_key_encrypted"),
      passphrase: readNullableTextColumn(row, 12, "passphrase_encrypted"),
    },
    lastCheck: readCheck(row),
    revision: readCountColumn(row, 16, "revision"),
  };
}

async function readConnections(
  database: DatabaseTransaction,
): Promise<readonly RemoteConnectionRecord[]> {
  const rows = await database.query(`
    SELECT
        ${CONNECTION_COLUMNS}
    FROM remote_connections
    ORDER BY lower(name), id;
  `);
  return rows.map(readConnection);
}

async function requireUniqueName(
  transaction: DatabaseTransaction,
  record: Pick<RemoteConnectionRecord, "id" | "name">,
): Promise<void> {
  const rows = await transaction.query(
    `
    SELECT id
    FROM remote_connections
    WHERE lower(name) = lower($name)
        AND id <> $id;
  `,
    { id: record.id, name: record.name },
  );
  if (rows.length > 0) throw new RemoteError("remote_connection_name_taken");
}

function recordParameters(
  record: RemoteConnectionRecord,
  actorId: string,
): Record<string, string | number | null> {
  return {
    id: record.id,
    name: record.name,
    host: record.host,
    port: record.port,
    username: record.username,
    auth_method: record.authMethod,
    department_id: record.departmentId,
    host_key_algorithm: record.hostKey?.algorithm ?? null,
    host_key: record.hostKey?.key ?? null,
    host_key_fingerprint: record.hostKey?.fingerprint ?? null,
    password_encrypted: record.secrets.password,
    private_key_encrypted: record.secrets.privateKey,
    passphrase_encrypted: record.secrets.passphrase,
    allowed_roots_json: JSON.stringify(record.allowedRoots),
    actor_id: actorId,
  };
}

/**
 * Stores SSH connections, their encrypted secrets and the latest test result.
 *
 * @remarks
 * Every write runs in one transaction with its revision and name checks, so
 * two administrators cannot overwrite each other unnoticed.
 */
export class RemoteConnectionRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /** Reads every connection from one coherent snapshot. */
  public async list(): Promise<readonly RemoteConnectionRecord[]> {
    return this.database.transaction(readConnections);
  }

  /** Returns one connection, or `null` when it does not exist. */
  public async find(id: string): Promise<RemoteConnectionRecord | null> {
    const connections = await this.list();
    return connections.find((connection) => connection.id === id) ?? null;
  }

  /** Counts the workspace profiles of every connection that has any. */
  public async workspaceCounts(): Promise<ReadonlyMap<string, number>> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(`
        SELECT
            connection_id,
            COUNT(*) AS workspace_count
        FROM remote_workspaces
        GROUP BY connection_id;
      `);
      return new Map(
        rows.map((row): [string, number] => [
          readTextColumn(row, 0, "connection_id"),
          readCountColumn(row, 1, "workspace_count"),
        ]),
      );
    });
  }

  /**
   * Inserts a new connection.
   *
   * @param record - The connection with encrypted secrets.
   * @param actorId - The administrator who creates it.
   * @throws {RemoteError} `remote_connection_name_taken` for a used name.
   */
  public async create(
    record: RemoteConnectionRecord,
    actorId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await requireUniqueName(transaction, record);
      await transaction.execute(
        `
        INSERT INTO remote_connections (
            id,
            name,
            host,
            port,
            username,
            auth_method,
            department_id,
            host_key_algorithm,
            host_key,
            host_key_fingerprint,
            password_encrypted,
            private_key_encrypted,
            passphrase_encrypted,
            allowed_roots_json,
            created_by,
            updated_by
        )
        VALUES (
            $id,
            $name,
            $host,
            $port,
            $username,
            $auth_method,
            $department_id,
            $host_key_algorithm,
            $host_key,
            $host_key_fingerprint,
            $password_encrypted,
            $private_key_encrypted,
            $passphrase_encrypted,
            $allowed_roots_json,
            $actor_id,
            $actor_id
        );
      `,
        recordParameters(record, actorId),
      );
    });
  }

  /**
   * Replaces a connection whose revision the caller last read; the test result is cleared.
   *
   * @param record - The connection as it should be stored, with the revision read before.
   * @param actorId - The administrator who changes it.
   * @throws {RemoteError} `remote_conflict` after a concurrent change.
   */
  public async update(
    record: RemoteConnectionRecord,
    actorId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const current = (await readConnections(transaction)).find(
        (connection) => connection.id === record.id,
      );
      if (!current) throw new RemoteError("remote_connection_not_found");
      if (current.revision !== record.revision)
        throw new RemoteError("remote_conflict");
      await requireUniqueName(transaction, record);
      await transaction.execute(
        `
        UPDATE remote_connections
        SET
            name = $name,
            host = $host,
            port = $port,
            username = $username,
            auth_method = $auth_method,
            department_id = $department_id,
            host_key_algorithm = $host_key_algorithm,
            host_key = $host_key,
            host_key_fingerprint = $host_key_fingerprint,
            password_encrypted = $password_encrypted,
            private_key_encrypted = $private_key_encrypted,
            passphrase_encrypted = $passphrase_encrypted,
            allowed_roots_json = $allowed_roots_json,
            checked_at = NULL,
            check_stage = NULL,
            check_code = NULL,
            updated_by = $actor_id,
            updated_at = utc_now(),
            revision = revision + 1
        WHERE id = $id;
      `,
        recordParameters(record, actorId),
      );
    });
  }

  /**
   * Records the latest test or connect result of an unchanged connection.
   *
   * @param id - The connection.
   * @param revision - The revision the result belongs to; a newer revision keeps its own state.
   * @param check - The classified result.
   */
  public async saveCheck(
    id: string,
    revision: number,
    check: RemoteConnectionCheck,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE remote_connections
        SET
            checked_at = $checked_at,
            check_stage = $check_stage,
            check_code = $check_code
        WHERE id = $id
            AND revision = $revision;
      `,
        {
          id,
          revision,
          checked_at: check.checkedAt,
          check_stage: check.stage,
          check_code: check.code,
        },
      );
    });
  }

  /**
   * Removes a connection without workspace profiles.
   *
   * @param id - The connection.
   * @param revision - The revision the caller last read.
   * @throws {RemoteError} `remote_connection_in_use` while profiles refer to it.
   */
  public async remove(id: string, revision: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const current = (await readConnections(transaction)).find(
        (connection) => connection.id === id,
      );
      if (!current) throw new RemoteError("remote_connection_not_found");
      if (current.revision !== revision)
        throw new RemoteError("remote_conflict");
      const profiles = await transaction.query(
        `
        SELECT id
        FROM remote_workspaces
        WHERE connection_id = $id;
      `,
        { id },
      );
      if (profiles.length > 0)
        throw new RemoteError("remote_connection_in_use");
      await transaction.execute(
        "DELETE FROM remote_connections WHERE id = $id;",
        { id },
      );
    });
  }
}
