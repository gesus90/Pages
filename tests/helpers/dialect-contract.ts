import { afterAll, afterEach } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

import type { SqlParameters } from "@/backend/database/Database";

/** The recorded calls of one `vi.fn()` spy. */
interface CallRecorder {
  readonly mock: { readonly calls: readonly unknown[][] };
}

/** A database double whose statements are recorded by spies. */
interface RecordingDatabase {
  readonly execute: CallRecorder;
  readonly query: CallRecorder;
}

const recordedDatabases: RecordingDatabase[] = [];
const validatedSignatures = new Set<string>();
let referenceDatabase: Promise<Database> | undefined;

function getReferenceDatabase(): Promise<Database> {
  referenceDatabase ??= (async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    await database.migrate(DATABASE_MIGRATIONS);

    return database;
  })();

  return referenceDatabase;
}

/** Identifies a statement together with the types of its parameters. */
function createSignature(statement: string, parameters: SqlParameters): string {
  const parameterTypes = Object.entries(parameters)
    .map(([name, value]) => `${name}:${describeType(value)}`)
    .sort();

  return `${statement}\n${parameterTypes.join(",")}`;
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  return Buffer.isBuffer(value) ? "blob" : typeof value;
}

async function validateCall(call: readonly unknown[]): Promise<void> {
  const [statement, parameters = {}] = call as [string, SqlParameters?];
  const signature = createSignature(statement, parameters);

  if (validatedSignatures.has(signature)) {
    return;
  }

  try {
    await (
      await getReferenceDatabase()
    ).query(`EXPLAIN ${statement}`, parameters);
  } catch (error: unknown) {
    throw new Error(
      `A repository sent SQL that DuckDB rejects with the baseline schema:\n${statement}`,
      { cause: error },
    );
  }

  validatedSignatures.add(signature);
}

/**
 * Registers a database double so that every statement a test sends through
 * it is checked against a real DuckDB with the baseline schema.
 *
 * @param database - Double whose `execute` and `query` are `vi.fn()` spies.
 *
 * @remarks
 * Repository tests answer queries with canned rows, so they never run the
 * SQL. This contract keeps them honest about the dialect: after each test,
 * the recorded statements are planned (`EXPLAIN`, no data is touched) with
 * the parameters the repository actually passed.
 */
export function recordForDialectContract(database: RecordingDatabase): void {
  recordedDatabases.push(database);
}

afterEach(async () => {
  const databases = recordedDatabases.splice(0);

  for (const database of databases) {
    for (const call of [
      ...database.execute.mock.calls,
      ...database.query.mock.calls,
    ]) {
      await validateCall(call);
    }
  }
});

afterAll(async () => {
  if (referenceDatabase) {
    await (await referenceDatabase).close();
    referenceDatabase = undefined;
  }
});
