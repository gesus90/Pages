import { createHash, randomUUID } from "node:crypto";

import { SESSION_LIFETIME_DAYS } from "@/backend/auth/SessionService";
import { createMigrationChecksum } from "@/backend/database/Migration";
import { provisionAccount } from "@/backend/database/repositories/LegacyAccountProvisioning";
import { ROLE } from "@/definition/Role";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { Migration } from "@/backend/database/Migration";
import type { SetupRecord } from "./SetupDatabaseWriter";

/** A database chosen for setup already contains public objects. */
export class SetupDatabaseNotEmptyError extends Error {}

async function applyMigrations(
  transaction: DatabaseTransaction,
  migrations: readonly Migration[],
): Promise<void> {
  await transaction.execute(`
    CREATE TABLE postgres_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
  `);
  for (const migration of [...migrations].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    await transaction.execute(migration.sql);
    await transaction.execute(
      "INSERT INTO postgres_schema_migrations (name, checksum) VALUES ($name, $checksum);",
      {
        name: migration.name,
        checksum: createMigrationChecksum(migration.sql),
      },
    );
  }
}

async function writeAdministrator(
  transaction: DatabaseTransaction,
  record: SetupRecord,
  token: string,
): Promise<string> {
  const userId = randomUUID();
  const user = {
    id: userId,
    username: record.username,
    displayName: record.username,
    passwordHash: record.passwordHash,
    email: record.email,
    role: ROLE.ADMIN,
  };
  await transaction.execute(
    `
    INSERT INTO users (id, username, display_name, password_hash, email, role)
    VALUES ($id, $username, $display_name, $password_hash, $email, $role);
  `,
    {
      id: userId,
      username: record.username,
      display_name: record.username,
      password_hash: record.passwordHash,
      email: record.email,
      role: ROLE.ADMIN,
    },
  );
  await provisionAccount(transaction, user);
  await transaction.execute(
    `
    INSERT INTO instance_settings (id, company_name, primary_administrator_id)
    VALUES (1, $company_name, $user_id);
  `,
    { company_name: record.companyName, user_id: userId },
  );
  await transaction.execute(
    `
    INSERT INTO user_settings (user_id, language) VALUES ($user_id, $language);
  `,
    { user_id: userId, language: record.language },
  );
  await transaction.execute(
    `
    INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at)
    VALUES ($id, $user_id, $token_hash, $user_agent, utc_after($lifetime_days * INTERVAL '1 day'));
  `,
    {
      id: randomUUID(),
      user_id: userId,
      token_hash: createHash("sha256").update(token).digest("hex"),
      user_agent: record.userAgent,
      lifetime_days: SESSION_LIFETIME_DAYS,
    },
  );
  return token;
}

/** Initializes an empty PostgreSQL schema and the first administrator atomically. */
export async function initializeSetupDatabase(
  database: Database,
  migrations: readonly Migration[],
  record: SetupRecord,
  sessionToken: string,
): Promise<string> {
  return database.transaction(async (transaction) => {
    await transaction.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;");
    await transaction.execute("SET LOCAL search_path TO public, pg_catalog;");
    await transaction.query("SELECT pg_advisory_xact_lock(704221);");
    const rows = await transaction.query(`
      SELECT EXISTS (SELECT 1 FROM pg_class AS object
        INNER JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
        WHERE namespace.nspname = 'public') OR EXISTS (SELECT 1 FROM pg_proc AS object
        INNER JOIN pg_namespace AS namespace ON namespace.oid = object.pronamespace
        WHERE namespace.nspname = 'public') OR EXISTS (SELECT 1 FROM pg_type AS object
        INNER JOIN pg_namespace AS namespace ON namespace.oid = object.typnamespace
        WHERE namespace.nspname = 'public' AND object.typtype IN ('d', 'e', 'r', 'm'));
    `);
    if (rows[0]?.[0] !== 0) throw new SetupDatabaseNotEmptyError();
    await applyMigrations(transaction, migrations);
    return writeAdministrator(transaction, record, sessionToken);
  });
}

/** Verifies that this database committed the private setup attempt. */
export async function hasCommittedSetup(
  database: Database,
  sessionToken: string,
): Promise<boolean> {
  const tables = await database.query("SELECT to_regclass('public.sessions');");
  if (tables[0]?.[0] === null) return false;
  const rows = await database.query(
    "SELECT user_id FROM sessions WHERE token_hash = $token_hash;",
    {
      token_hash: createHash("sha256").update(sessionToken).digest("hex"),
    },
  );
  return rows.length === 1;
}

/** Renews only the session belonging to a verified recovery intent. */
export async function renewSetupSession(
  database: Database,
  sessionToken: string,
): Promise<void> {
  await database.execute(
    "UPDATE sessions SET expires_at = utc_after($days * INTERVAL '1 day') WHERE token_hash = $token_hash;",
    {
      days: SESSION_LIFETIME_DAYS,
      token_hash: createHash("sha256").update(sessionToken).digest("hex"),
    },
  );
}
