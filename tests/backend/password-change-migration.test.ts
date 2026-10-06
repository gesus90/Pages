import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

describe("mandatory password migration", () => {
  it("keeps accounts and case-insensitive uniqueness when upgrading 003", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "004"),
      );
      await database.execute(`
        INSERT INTO users (id, username, display_name, password_hash, role)
        VALUES ('u1', 'Anna', 'Anna', 'old-hash', 'employee');
      `);
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(
        await database.query(`
        SELECT id, username, password_hash, must_change_password FROM users;
      `),
      ).toEqual([["u1", "Anna", "old-hash", 0]]);
      await expect(
        database.execute(`
        INSERT INTO users (id, username, display_name, password_hash, role)
        VALUES ('u2', 'ANNA', 'Other', 'hash', 'employee');
      `),
      ).rejects.toThrow("Duplicate key");
      await expect(
        database.execute(`
        UPDATE users SET must_change_password = NULL WHERE id = 'u1';
      `),
      ).rejects.toThrow("NOT NULL");
    } finally {
      await database.close();
    }
  });
});
