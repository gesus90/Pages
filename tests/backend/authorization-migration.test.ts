import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { CAPABILITY, isCapability } from "@/definition/Authorization";

describe("authorization contracts", () => {
  it("recognizes the complete fixed capability catalog", () => {
    for (const permission of Object.values(CAPABILITY)) {
      expect(isCapability(permission)).toBe(true);
    }
    expect(isCapability("is_admin")).toBe(false);
    expect(isCapability(null)).toBe(false);
  });
});

describe("A2 authorization migration", () => {
  it("creates no predefined roles or departments for a fresh instance", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(DATABASE_MIGRATIONS);
      expect(await database.query("SELECT COUNT(*) FROM roles;")).toEqual([
        [0],
      ]);
      expect(await database.query("SELECT COUNT(*) FROM departments;")).toEqual(
        [[0]],
      );
    } finally {
      await database.close();
    }
  });

  it("preserves legacy accounts without giving managers role administration", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "005"),
      );
      await database.execute(`
        INSERT INTO users (id, username, display_name, password_hash, role, is_active)
        VALUES ('a', 'Anna', 'Same Name', 'admin-hash', 'admin', 1),
            ('m', 'Manager', 'Same Name', 'manager-hash', 'manager', 1),
            ('e', 'Employee', 'Old Name', 'employee-hash', 'employee', 0);
      `);
      const before = await database.query(
        "SELECT id, username, display_name, password_hash, role, is_active FROM users ORDER BY id;",
      );
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(
        await database.query(
          "SELECT id, username, display_name, password_hash, role, is_active FROM users ORDER BY id;",
        ),
      ).toEqual(before);
      expect(
        await database.query(
          "SELECT user_id, role_id, is_admin, active_mode, first_name, last_name, all_projects FROM user_authorization ORDER BY user_id;",
        ),
      ).toEqual([
        ["a", null, 1, "admin", "Same Name", "", 0],
        ["e", "legacy-employee", 0, "role", "Old Name", "", 0],
        ["m", "legacy-manager", 0, "role", "Same Name", "", 1],
      ]);
      expect(
        await database.query(
          "SELECT role_id, permission FROM role_permissions WHERE permission IN ('manage_roles', 'manage_departments');",
        ),
      ).toEqual([]);
      expect(
        await database.query(
          "SELECT id, department_bound FROM roles ORDER BY id;",
        ),
      ).toEqual([
        ["legacy-employee", 0],
        ["legacy-manager", 0],
      ]);
      await expect(
        database.execute(
          "UPDATE user_authorization SET active_mode = 'role' WHERE user_id = 'a';",
        ),
      ).rejects.toThrow("CHECK");
      await expect(
        database.execute(
          "UPDATE user_authorization SET is_admin = 0 WHERE user_id = 'a';",
        ),
      ).rejects.toThrow("CHECK");
    } finally {
      await database.close();
    }
  });
});

describe("A3 project capability migration", () => {
  it("merges old creation grants and does not automatically grant archiving", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "008"),
      );
      await database.execute(`
        INSERT INTO roles (id, name, hierarchy_rank) VALUES ('manager', 'Manager', 20);
        INSERT INTO role_permissions (role_id, permission)
        VALUES ('manager', 'create_projects'), ('manager', 'manage_projects');
      `);
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(
        await database.query(
          "SELECT role_id, permission FROM role_permissions;",
        ),
      ).toEqual([["manager", "manage_projects"]]);
      await expect(
        database.execute(
          "INSERT INTO role_permissions (role_id, permission) VALUES ('manager', 'create_projects');",
        ),
      ).rejects.toThrow("CHECK");
      await database.execute(
        "INSERT INTO role_permissions (role_id, permission) VALUES ('manager', 'archive_projects');",
      );
      expect(
        await database.query(
          "SELECT COUNT(*) FROM role_permissions WHERE permission = 'archive_projects';",
        ),
      ).toEqual([[1]]);
    } finally {
      await database.close();
    }
  });
});
