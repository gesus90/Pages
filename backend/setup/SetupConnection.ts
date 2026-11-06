import { registerLogSecret } from "@/backend/logging/LogRedaction";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import type { DatabaseLocationStatus } from "@/definition/Setup";

/** Validates a setup connection without logging or returning its contents. */
export function isSetupDatabaseUrl(input: string): boolean {
  if (input.length === 0 || input.length > 4096 || input.includes("\u0000"))
    return false;
  try {
    const url = new URL(input);
    decodeURIComponent(url.password);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

/** Checks connectivity and whether the public schema contains existing objects. */
export async function checkSetupConnection(
  input: string,
): Promise<DatabaseLocationStatus> {
  if (input.length === 0) return DATABASE_LOCATION_STATUS.EMPTY;
  if (!isSetupDatabaseUrl(input)) return DATABASE_LOCATION_STATUS.INVALID;
  registerLogSecret(input);
  const url = new URL(input);
  registerLogSecret(decodeURIComponent(url.password));
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: input,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await client.query<{ occupied: boolean }>(`
      SELECT EXISTS (
          SELECT 1 FROM pg_class AS object
          INNER JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
          WHERE namespace.nspname = 'public'
      ) OR EXISTS (
          SELECT 1 FROM pg_proc AS object
          INNER JOIN pg_namespace AS namespace ON namespace.oid = object.pronamespace
          WHERE namespace.nspname = 'public'
      ) OR EXISTS (
          SELECT 1 FROM pg_type AS object
          INNER JOIN pg_namespace AS namespace ON namespace.oid = object.typnamespace
          WHERE namespace.nspname = 'public' AND object.typtype IN ('d', 'e', 'r', 'm')
      ) AS occupied;
    `);
    return result.rows[0]?.occupied === false
      ? DATABASE_LOCATION_STATUS.AVAILABLE
      : DATABASE_LOCATION_STATUS.FOREIGN;
  } catch {
    return DATABASE_LOCATION_STATUS.NOT_WRITABLE;
  } finally {
    await client.end();
  }
}
