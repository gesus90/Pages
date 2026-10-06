import { vi } from "vitest";

import { ROLE } from "@/definition/Role";

import { recordForDialectContract } from "./dialect-contract";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { User } from "@/definition/User";

/**
 * Builds an active administrator.
 *
 * @param overrides - Values replacing the defaults.
 * @returns A user that satisfies the `User` contract.
 */
export function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    mustChangePassword: false,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

/** A database double whose statements are `vi.fn()` spies. */
export type DatabaseDouble = Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

/**
 * Builds a database double for repository tests that assert on statements.
 *
 * @returns A database whose `execute` and `query` return `undefined` until
 * a test configures them. Every statement it receives is later checked
 * against DuckDB, see {@link recordForDialectContract}.
 */
export function createDatabase(): DatabaseDouble {
  const database = {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
    transaction: async <Result>(
      work: (transaction: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(database),
  } as unknown as DatabaseDouble;

  recordForDialectContract(database);

  return database;
}
