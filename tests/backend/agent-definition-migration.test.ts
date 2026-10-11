import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";

describe("A10.2 central agent migration", () => {
  it("splits mixed legacy scopes without broadening grants and preserves SKILLS as an inactive legacy reference", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "030"),
      );
      await database.execute(`
        INSERT INTO agent_function_assignments (
            function,
            connection_id,
            model,
            reasoning_effort
        ) VALUES
            ('text', 'connection', 'text-model', 'medium'),
            ('skills', 'legacy-connection', 'legacy-model', NULL);
      `);
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "031"),
      );
      await database.execute(`
        INSERT INTO agent_profile_targets (
            profile_id,
            kind,
            target_id
        ) VALUES
            ('system-text', 'person', 'alice'),
            ('system-text', 'group', 'team'),
            ('system-text', 'department', 'department');
      `);
      await database.migrate(DATABASE_MIGRATIONS);
      const profiles = await new AgentProfileRepository(database).list();
      expect(profiles).toHaveLength(5);
      const personal = profiles.find((profile) => profile.id === "system-text");
      expect(personal).toMatchObject({
        targets: [{ kind: "person", targetId: "alice" }],
        configuration: {
          scope: "person",
          accessMode: "personal",
          sharing: {
            isGlobal: false,
            targets: [{ kind: "person", targetId: "alice" }],
          },
        },
      });
      for (const scope of ["group", "department", "system"]) {
        const copied = profiles.find(
          (profile) => profile.id === `system-text-scope-${scope}`,
        );
        expect(copied?.purposes).toEqual(["chat", "text"]);
        expect(copied?.configuration?.scope).toBe(scope);
        expect(copied?.targets.every((target) => target.kind === scope)).toBe(
          true,
        );
      }
      expect(
        profiles.find((profile) => profile.id === "legacy-skills"),
      ).toMatchObject({
        isActive: false,
        model: "legacy-model",
        purposes: ["agent"],
        targets: [],
        configuration: { sharing: { isGlobal: false, targets: [] } },
      });
      expect(await new AgentAssignmentRepository(database).list()).toEqual([
        {
          function: "skills",
          connectionId: "legacy-connection",
          model: "legacy-model",
          reasoningEffort: null,
        },
        {
          function: "text",
          connectionId: "connection",
          model: "text-model",
          reasoningEffort: "medium",
        },
      ]);
      await expect(
        database.execute(
          "UPDATE agent_function_assignments SET model = 'duplicate';",
        ),
      ).rejects.toThrow();
      expect(
        await new AgentProfileRepository(database).usages("legacy-skills"),
      ).toEqual([{ kind: "legacy", id: "skills" }]);
    } finally {
      await database.close();
    }
  });
});
