import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";

import type { Role } from "@/definition/Role";

/** Accounts a test database file starts with. */
export interface PagesDatabaseFileOptions {
  readonly users?: readonly {
    readonly id: string;
    readonly username: string;
    readonly role?: Role;
    readonly isActive?: boolean;
    readonly email?: string | null;
    readonly passwordHash?: string;
  }[];
}

/**
 * Writes a migrated Pages database file for a test, then closes it.
 *
 * @param filePath - Where to create the file; it must not exist yet.
 * @param options - Accounts to create.
 */
export async function createPagesDatabaseFile(
  filePath: string,
  options: PagesDatabaseFileOptions = {},
): Promise<void> {
  const database = await Database.create(filePath);

  try {
    await database.migrate(DATABASE_MIGRATIONS);

    const users = new UserRepository(database);

    for (const user of options.users ?? []) {
      await users.insert({
        displayName: user.username,
        email: user.email ?? null,
        id: user.id,
        isActive: user.isActive ?? true,
        passwordHash: user.passwordHash ?? "scrypt$test",
        role: user.role ?? ROLE.ADMIN,
        username: user.username,
      });
    }
  } finally {
    await database.close();
  }
}
