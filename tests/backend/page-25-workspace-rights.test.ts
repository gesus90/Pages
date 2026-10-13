import { afterEach, describe, expect, it } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWorkspaceRightsHarness } from "../helpers/workspace-rights";

import type { WorkspaceRightsHarness } from "../helpers/workspace-rights";

interface Actor {
  readonly name: string;
  /** The project the actor may manage, or the one it is denied on. */
  readonly projectId: string;
  /** Other projects the person does manage, which the registration form offers. */
  readonly manages?: readonly string[];
  readonly create: (harness: WorkspaceRightsHarness) => Promise<string>;
}

const MANAGERS: readonly Actor[] = [
  {
    name: "a Pages administrator in admin mode",
    projectId: "project",
    create: async (harness) => harness.admin.userId,
  },
  {
    name: "a manager of the project",
    projectId: "project",
    create: (harness) =>
      harness.person("lead", { projectRoles: { project: "manager" } }),
  },
  {
    name: "a department manager with the project right and scope",
    projectId: "engineering-project",
    create: (harness) =>
      harness.person("department-manager", {
        capabilities: [CAPABILITY.MANAGE_PROJECTS],
        isDepartmentBound: true,
        departments: ["engineering"],
        managedDepartments: ["engineering"],
      }),
  },
  {
    name: "a person with the project right for all projects",
    projectId: "project",
    create: (harness) =>
      harness.person("all-projects", {
        capabilities: [CAPABILITY.MANAGE_PROJECTS],
        allProjects: true,
      }),
  },
];

const OTHERS: readonly Actor[] = [
  {
    name: "a member of the project",
    projectId: "project",
    create: (harness) =>
      harness.person("member", { projectRoles: { project: "member" } }),
  },
  {
    name: "a viewer of the project",
    projectId: "project",
    create: (harness) =>
      harness.person("viewer", { projectRoles: { project: "viewer" } }),
  },
  {
    name: "a person without a project role",
    projectId: "project",
    create: (harness) => harness.person("plain"),
  },
  {
    name: "a manager of another project",
    projectId: "project",
    manages: ["shared"],
    create: (harness) =>
      harness.person("other-lead", { projectRoles: { shared: "manager" } }),
  },
  {
    name: "a person with the project right but no scope over the project",
    projectId: "engineering-project",
    create: (harness) =>
      harness.person("no-scope", {
        capabilities: [CAPABILITY.MANAGE_PROJECTS],
        isDepartmentBound: true,
        departments: ["engineering"],
        managedDepartments: ["design"],
      }),
  },
  {
    name: "an administrator who works in role mode",
    projectId: "project",
    create: (harness) =>
      harness.person("role-mode-admin", { isAdmin: true, mode: "role" }),
  },
];

describe("PAGE-25 workspace management rights", () => {
  const getDatabase = useMigratedDatabase();
  let harness: WorkspaceRightsHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup(): Promise<WorkspaceRightsHarness> {
    harness = await createWorkspaceRightsHarness(getDatabase());
    return harness;
  }

  describe.each(MANAGERS)("$name", (manager) => {
    it("registers, edits and removes a workspace of the project", async () => {
      const current = await setup();
      const userId = await manager.create(current);
      const directory = await current.directory("managed");
      const id = await current.workspaces.save(userId, null, {
        name: "Managed",
        path: directory,
        projectId: manager.projectId,
      });
      const page = await current.workspaces.page(userId);
      expect(page.canManage).toBe(true);
      expect(page.projects.map((project) => project.id)).toContain(
        manager.projectId,
      );
      expect(page.workspaces.find((entry) => entry.id === id)).toMatchObject({
        name: "Managed",
        path: directory,
        projectId: manager.projectId,
        canManage: true,
        isUsable: true,
      });
      await current.workspaces.save(userId, id, {
        name: "Renamed",
        path: directory,
        projectId: manager.projectId,
        revision: 1,
      });
      expect((await current.repository.list())[0]).toMatchObject({
        name: "Renamed",
        revision: 2,
      });
      await expect(current.workspaces.usages(userId, id)).resolves.toEqual([]);
      await current.workspaces.remove(userId, id, 2);
      expect(await current.repository.list()).toEqual([]);
    });
  });

  describe.each(OTHERS)("$name", (other) => {
    it("sees the workspace but gets no management action and changes nothing", async () => {
      const current = await setup();
      const id = await current.register({ projectId: other.projectId });
      const before = await current.repository.list();
      const userId = await other.create(current);
      const directory = await current.directory("attempt");
      const page = await current.workspaces.page(userId);
      const manages = other.manages ?? [];
      expect(page.canManage).toBe(manages.length > 0);
      expect(page.projects.map((project) => project.id)).toEqual(manages);
      expect(page.workspaces.find((entry) => entry.id === id)).toMatchObject({
        canManage: false,
      });
      const denied = { code: "workspace_management_denied" };
      await expect(
        current.workspaces.save(userId, null, {
          name: "Attempt",
          path: directory,
          projectId: other.projectId,
        }),
      ).rejects.toMatchObject(denied);
      await expect(
        current.workspaces.save(userId, id, {
          name: "Attempt",
          path: before[0].path,
          projectId: other.projectId,
          revision: 1,
        }),
      ).rejects.toMatchObject(denied);
      await expect(current.workspaces.usages(userId, id)).rejects.toMatchObject(
        denied,
      );
      await expect(
        current.workspaces.remove(userId, id, 1),
      ).rejects.toMatchObject(denied);
      expect(await current.repository.list()).toEqual(before);
    });
  });

  it("rechecks the rights at the moment of every action", async () => {
    const current = await setup();
    const userId = await current.person("lead", {
      projectRoles: { project: "manager" },
    });
    const id = await current.register({}, userId);
    await current.projects.updateMemberRole("project", userId, "member");
    await expect(
      current.workspaces.remove(userId, id, 1),
    ).rejects.toMatchObject({ code: "workspace_management_denied" });
    expect(await current.repository.list()).toHaveLength(1);
    await current.projects.updateMemberRole("project", userId, "manager");
    await current.workspaces.remove(userId, id, 1);
    expect(await current.repository.list()).toEqual([]);
  });

  it("refuses an inactive account every management action", async () => {
    const current = await setup();
    const userId = await current.person("lead", {
      projectRoles: { project: "manager" },
    });
    const id = await current.register({}, userId);
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = $id;",
      { id: userId },
    );
    await expect(current.workspaces.page(userId)).rejects.toMatchObject({
      code: "workspace_access_denied",
    });
    await expect(
      current.workspaces.remove(userId, id, 1),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    await expect(
      current.workspaces.save(userId, null, {
        name: "Late",
        path: await current.directory("late"),
        projectId: "project",
      }),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    expect(await current.repository.list()).toHaveLength(1);
  });

  it("needs rights on the stored and on the chosen project to move a workspace", async () => {
    const current = await setup();
    const lead = await current.person("lead", {
      projectRoles: { project: "manager", shared: "member" },
    });
    const id = await current.register({}, lead);
    const registered = (await current.repository.list())[0];
    await expect(
      current.workspaces.save(lead, id, {
        name: registered.name,
        path: registered.path,
        projectId: "shared",
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "workspace_management_denied" });
    expect((await current.repository.list())[0].projectId).toBe("project");
    await current.projects.updateMemberRole("shared", lead, "manager");
    await current.workspaces.save(lead, id, {
      name: registered.name,
      path: registered.path,
      projectId: "shared",
      revision: 1,
    });
    expect((await current.repository.list())[0].projectId).toBe("shared");
    // The former project is no longer the lead's to manage: stored project rules apply.
    await current.projects.updateMemberRole("shared", lead, "member");
    await expect(
      current.workspaces.save(lead, id, {
        name: registered.name,
        path: registered.path,
        projectId: "project",
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: "workspace_management_denied" });
  });

  it("lists only the projects a person may manage and only for the matching rights", async () => {
    const current = await setup();
    const lead = await current.person("lead", {
      projectRoles: { project: "manager", unlinked: "manager" },
    });
    const page = await current.workspaces.page(lead);
    expect(page.projects.map((project) => project.id).sort()).toEqual([
      "project",
      "unlinked",
    ]);
    expect(
      Object.fromEntries(
        page.projects.map((project) => [project.id, project.github === null]),
      ),
    ).toEqual({ project: false, unlinked: true });
    const admin = await current.workspaces.page(current.admin.userId);
    expect(admin.isAdministrator).toBe(true);
    expect(page.isAdministrator).toBe(false);
    expect(admin.projects.map((project) => project.id).sort()).toEqual(
      ["engineering-project", "project", "shared", "unlinked"].sort(),
    );
  });

  it("tells only administrators who still uses a workspace", async () => {
    const current = await setup();
    const lead = await current.person("lead", {
      projectRoles: { project: "manager" },
    });
    const id = await current.register();
    const database = getDatabase();
    await database.execute(
      `
        INSERT INTO agent_plans (id, owner_id, project_id, workspace_id, name, usage, plan_json)
        VALUES ('plan-1', $owner, 'project', $workspace, 'Private release plan', 'private', '{"nodes":[]}');
      `,
      { owner: current.alice.id, workspace: id },
    );
    await database.execute(
      `
        INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
        VALUES ($workspace, 'run-1');
      `,
      { workspace: id },
    );
    expect(await current.workspaces.usages(current.admin.userId, id)).toEqual([
      { id: "plan-1", name: "Private release plan", kind: "plan" },
      { id: "run-1", name: null, kind: "run" },
    ]);
    const hidden = await current.workspaces.usages(lead, id);
    expect(hidden).toEqual([
      { id: null, name: null, kind: "plan" },
      { id: null, name: null, kind: "run" },
    ]);
    expect(JSON.stringify(hidden)).not.toMatch(/plan-1|run-1|Private release/);
    await expect(current.workspaces.remove(lead, id, 1)).rejects.toMatchObject({
      code: "workspace_in_use",
    });
  });
});
