import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";

import { createAssistantHarness } from "../helpers/text-assistant";

describe("PAGE-25 migration 041", () => {
  it("names the migration after the next free number", () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name).sort();
    const index = names.indexOf("041_agent_workspace_project_access.sql");

    expect(names[index - 1]).toMatch(/^040_/u);
    expect(names.filter((name) => name.startsWith("041_"))).toHaveLength(1);
  });

  it("drops the usage grants, keeps every registration and lets project access decide", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pages-workspace-041-"));
    const approved = path.join(root, "approved");
    const directory = path.join(approved, "legacy");
    await mkdir(directory, { recursive: true });
    await mkdir(path.join(root, "instance"));
    const paths = new AgentWorkspacePath({
      roots: [approved],
      protectedDirectory: path.join(root, "instance"),
    });
    const inspected = await paths.inspect(directory);
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    let wikiFiles = "";
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((entry) => entry.name < "041"),
      );
      await database.execute(
        `
          INSERT INTO agent_workspaces (id, name, path, directory_identity, project_id, registered_by, revision)
          VALUES ('legacy', 'Legacy', $path, $identity, 'project', 'alice', 3);
        `,
        { path: inspected.path, identity: inspected.identity },
      );
      await database.execute(`
        INSERT INTO agent_workspace_targets (workspace_id, kind, target_id)
        VALUES ('legacy', 'person', 'alice');
      `);

      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);

      expect(
        await database.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_name = 'agent_workspace_targets';
        `),
      ).toEqual([]);
      expect(
        await database.query(
          "SELECT id, name, path, project_id, registered_by, revision FROM agent_workspaces;",
        ),
      ).toEqual([["legacy", "Legacy", inspected.path, "project", "alice", 3]]);

      // The grant named only alice; now everyone who can open the project sees the workspace.
      const base = await createAssistantHarness(database);
      wikiFiles = base.wiki.filesDirectory;
      const projects = new ProjectRepository(database);
      await projects.upsertIntegration("project", {
        repoUrl: "https://github.com/example/project",
        repoName: "example/project",
        tokenHash: "synthetic-hash",
        tokenEncrypted: "synthetic-ciphertext",
        syncIssues: false,
        syncStatus: false,
        syncComments: false,
        syncPullRequests: false,
        syncCommits: false,
        syncDirection: "pull",
        syncIntervalMinutes: 0,
        isConnected: true,
        lastSyncAt: null,
      });
      const workspaces = new AgentWorkspaceService({
        workspaces: new AgentWorkspaceRepository(database),
        projects,
        authorization: base.authorization,
        paths,
      });
      expect(await workspaces.choices(base.bob.id)).toEqual([
        {
          id: "legacy",
          name: "Legacy",
          path: inspected.path,
          projectId: "project",
          projectName: "Project project",
          github: {
            repoUrl: "https://github.com/example/project",
            repoName: "example/project",
          },
          isUsable: true,
          reason: null,
        },
      ]);
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
      if (wikiFiles) await rm(wikiFiles, { recursive: true, force: true });
    }
  });
});
