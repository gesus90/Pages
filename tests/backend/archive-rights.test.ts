import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { CAPABILITY } from "@/definition/Authorization";

import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type { AccountAccess, Capability } from "@/definition/Authorization";

const ADMIN = createUser({ id: "admin" });
const ROLE_ADMIN = createUser({ id: "roleadmin" });
const MANAGER = createUser({ id: "manager" });
const PLAIN_MANAGER = createUser({ id: "plainmanager" });
const WRITER = createUser({ id: "writer" });
const LEAD = createUser({ id: "lead" });
const LEAD_WITH_RIGHT = createUser({ id: "leadright" });
const MILESTONES_ONLY = createUser({ id: "milestonesonly" });
const BETA_MANAGER = createUser({ id: "betamanager" });

const WRITE_ONLY: readonly Capability[] = [CAPABILITY.WRITE];

/** One account of the fixture; the role is named after the account. */
function account(
  userId: string,
  overrides: Partial<AccountAccess> & {
    readonly capabilities?: readonly Capability[];
  } = {},
): AccountAccess {
  const { capabilities = WRITE_ONLY, ...access } = overrides;

  return createAccess({
    departments: ["frontend"],
    managedDepartments: [],
    role: createRole({
      id: `role-${userId}`,
      name: `Role ${userId}`,
      permissions: capabilities,
    }),
    userId,
    ...access,
  });
}

const ACCOUNTS: readonly AccountAccess[] = [
  account("admin", {
    departments: [],
    isAdmin: true,
    mode: "admin",
    role: null,
  }),
  account("roleadmin", { isAdmin: true, mode: "role" }),
  account("manager", {
    capabilities: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MILESTONES,
    ],
    managedDepartments: ["frontend"],
  }),
  account("plainmanager", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    managedDepartments: ["frontend"],
  }),
  account("writer"),
  account("lead"),
  account("leadright", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MILESTONES],
  }),
  account("milestonesonly", { capabilities: [CAPABILITY.MILESTONES] }),
  account("betamanager", {
    capabilities: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MILESTONES,
    ],
    departments: ["frontend", "backend"],
    managedDepartments: ["backend"],
  }),
];

describe("archiving tickets and milestones needs the milestone right in scope", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);

    await database.execute(`
      INSERT INTO departments (id, name)
      VALUES ('frontend', 'Frontend'), ('backend', 'Backend'), ('support', 'Support');
    `);

    for (const entry of ACCOUNTS) {
      await authorization.users().insert({
        displayName: entry.userId,
        id: entry.userId,
        passwordHash: "hash",
        role: "employee",
        username: entry.userId,
      });

      if (entry.role) {
        await authorization.saveRole(entry.role);
      }

      await authorization.saveAccount(entry);
    }

    await database.execute(`
      INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Alpha', 'admin'), ('p2', 'Beta', 'admin');
      INSERT INTO project_departments (project_id, department_id) VALUES ('p1', 'frontend'), ('p2', 'backend');
      INSERT INTO project_members (project_id, user_id, role)
      VALUES ('p1', 'lead', 'manager'), ('p1', 'leadright', 'manager');
      INSERT INTO milestones (id, project_id, name, status)
      VALUES ('m1', 'p1', 'Release', 'open'), ('m2', 'p1', 'Launch', 'open'), ('m3', 'p2', 'Beta release', 'open');
      INSERT INTO milestone_dependencies (id, project_id, source_id, target_id, link_type)
      VALUES ('d1', 'p1', 'm1', 'm2', 'blocks');
      INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by, department_id, milestone_id, sort_order)
      VALUES ('epic', 'p1', 'ALPHA-1', 1, 'epic', NULL, 'Epic', 'status-in-progress', 'admin', NULL, NULL, 1),
          ('task', 'p1', 'ALPHA-2', 2, 'task', 'epic', 'Task', 'status-review', 'admin', 'frontend', 'm1', 2),
          ('sub', 'p1', 'ALPHA-3', 3, 'subtask', 'task', 'Subtask', 'status-todo', 'admin', 'frontend', NULL, 3),
          ('leaf', 'p1', 'ALPHA-4', 4, 'task', NULL, 'Leaf', 'status-todo', 'admin', NULL, 'm1', 4),
          ('hidden', 'p1', 'ALPHA-5', 5, 'task', 'epic', 'Support task', 'status-todo', 'admin', 'support', NULL, 5),
          ('beta', 'p2', 'BETA-1', 1, 'task', NULL, 'Beta task', 'status-todo', 'admin', NULL, 'm3', 1),
          ('beta2', 'p2', 'BETA-2', 2, 'task', NULL, 'Second beta task', 'status-todo', 'admin', NULL, NULL, 2);
    `);

    const cache = new ServerCache();
    const repository = new TaskRepository(database);
    const projects = new ProjectRepository(database);
    const permissions = new PermissionService(async (userId) => {
      const found = (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === userId,
      );

      if (!found) {
        throw new Error("unknown account");
      }

      return found;
    });

    return {
      authorization,
      database,
      tasks: new TaskService(
        repository,
        new ProjectService(projects, permissions, null, cache),
        permissions,
        cache,
      ),
    };
  }

  async function archivedKeys(database: Database): Promise<string[]> {
    const rows = await database.query(
      "SELECT key FROM work_items WHERE archived_at IS NOT NULL ORDER BY key;",
    );

    return rows.map((row) => String(row[0]));
  }

  async function archivedMilestones(database: Database): Promise<string[]> {
    const rows = await database.query(
      "SELECT id FROM milestones WHERE archived_at IS NOT NULL ORDER BY id;",
    );

    return rows.map((row) => String(row[0]));
  }

  async function dependencyCount(database: Database): Promise<number> {
    const rows = await database.query(
      "SELECT COUNT(*) FROM milestone_dependencies;",
    );

    return Number(rows[0]?.[0]);
  }

  it("lets an administrator in administrator mode archive any visible ticket and milestone", async () => {
    const { tasks, database } = await setup();

    await expect(tasks.describeDescendants(ADMIN, "epic")).resolves.toEqual({
      active: { epic: 0, initiative: 0, subtask: 1, task: 2 },
      all: { epic: 0, initiative: 0, subtask: 1, task: 2 },
      canArchive: true,
    });

    await tasks.archive(ADMIN, "epic");
    await tasks.archiveMilestone(ADMIN, "m3");

    expect(await archivedKeys(database)).toEqual([
      "ALPHA-1",
      "ALPHA-2",
      "ALPHA-3",
      "ALPHA-5",
    ]);
    expect(await archivedMilestones(database)).toEqual(["m3"]);
  });

  it("treats an administrator in role mode like the role they chose", async () => {
    const { tasks, database } = await setup();

    expect(
      (await tasks.describeDescendants(ROLE_ADMIN, "leaf")).canArchive,
    ).toBe(false);
    await expect(tasks.archive(ROLE_ADMIN, "leaf")).rejects.toThrow(
      "not allowed",
    );
    await expect(tasks.archiveMilestone(ROLE_ADMIN, "m1")).rejects.toThrow(
      "not allowed",
    );
    expect(await archivedKeys(database)).toEqual([]);
    expect(await archivedMilestones(database)).toEqual([]);
  });

  it("lets a manager with the milestone right archive a ticket with its active descendants and keeps every status", async () => {
    const { tasks, database } = await setup();

    await expect(tasks.describeDescendants(MANAGER, "task")).resolves.toEqual({
      active: { epic: 0, initiative: 0, subtask: 1, task: 0 },
      all: { epic: 0, initiative: 0, subtask: 1, task: 0 },
      canArchive: true,
    });

    await tasks.archive(MANAGER, "task");

    expect(await archivedKeys(database)).toEqual(["ALPHA-2", "ALPHA-3"]);

    const statuses = await database.query(
      "SELECT id, status_id FROM work_items WHERE archived_at IS NOT NULL ORDER BY id;",
    );

    expect(statuses).toEqual([
      ["sub", "status-todo"],
      ["task", "status-review"],
    ]);
  });

  it("archives a milestone without its tickets and removes its dependencies", async () => {
    const { tasks, database } = await setup();

    await tasks.archiveMilestone(MANAGER, "m1");

    expect(await archivedMilestones(database)).toEqual(["m1"]);
    expect(await dependencyCount(database)).toBe(0);
    expect(await archivedKeys(database)).toEqual([]);

    const assigned = await database.query(
      "SELECT id, milestone_id FROM work_items WHERE milestone_id = 'm1' ORDER BY id;",
    );

    expect(assigned).toEqual([
      ["leaf", "m1"],
      ["task", "m1"],
    ]);
    expect(
      (await tasks.findMilestones(MANAGER, ["p1"])).map((entry) => entry.id),
    ).toEqual(["m2"]);
    expect(
      await database.query("SELECT status FROM milestones WHERE id = 'm1';"),
    ).toEqual([["open"]]);
  });

  it.each([
    ["an ordinary writer", WRITER],
    ["a manager of assignments without the milestone right", PLAIN_MANAGER],
    ["a project lead without the milestone right", LEAD],
  ])("refuses %s and changes nothing", async (_label, actor) => {
    const { tasks, database } = await setup();

    expect((await tasks.describeDescendants(actor, "leaf")).canArchive).toBe(
      false,
    );
    await expect(tasks.archive(actor, "leaf")).rejects.toThrow("not allowed");
    await expect(tasks.archive(actor, "task", "keep")).rejects.toThrow(
      "not allowed",
    );
    await expect(tasks.archiveMilestone(actor, "m1")).rejects.toThrow(
      "not allowed",
    );
    expect(await tasks.canArchive(actor, "p1")).toBe(false);
    expect(await archivedKeys(database)).toEqual([]);
    expect(await archivedMilestones(database)).toEqual([]);
    expect(await dependencyCount(database)).toBe(1);
  });

  it("needs the project responsibility as well as the milestone right", async () => {
    const { tasks, database } = await setup();

    // The right without any responsibility for the project changes nothing.
    await expect(tasks.archive(MILESTONES_ONLY, "leaf")).rejects.toThrow(
      "not allowed",
    );
    // Responsibility for another project does not carry over to this one.
    expect(
      (await tasks.describeDescendants(BETA_MANAGER, "leaf")).canArchive,
    ).toBe(false);
    await expect(tasks.archive(BETA_MANAGER, "leaf")).rejects.toThrow(
      "not allowed",
    );
    await expect(tasks.archiveMilestone(BETA_MANAGER, "m1")).rejects.toThrow(
      "not allowed",
    );
    expect(await archivedKeys(database)).toEqual([]);

    // The same person archives where their responsibility lies.
    await tasks.archive(BETA_MANAGER, "beta");
    await tasks.archiveMilestone(BETA_MANAGER, "m3");
    expect(await archivedKeys(database)).toEqual(["BETA-1"]);
    expect(await archivedMilestones(database)).toEqual(["m3"]);
  });

  it("accepts the project lead who holds the milestone right", async () => {
    const { tasks, database } = await setup();

    expect(await tasks.canArchive(LEAD_WITH_RIGHT, "p1")).toBe(true);
    expect(await tasks.canArchive(LEAD_WITH_RIGHT, "p2")).toBe(false);

    await tasks.archive(LEAD_WITH_RIGHT, "leaf");
    expect(await archivedKeys(database)).toEqual(["ALPHA-4"]);
  });

  it("keeps tickets outside the department scope out of reach", async () => {
    const { tasks, database } = await setup();

    await expect(tasks.archive(MANAGER, "hidden")).rejects.toThrow(
      "does not exist",
    );
    await expect(tasks.archive(MANAGER, "epic")).rejects.toThrow(
      "not visible to you",
    );
    expect(await archivedKeys(database)).toEqual([]);
  });

  it("checks the right again for every call, whatever the client was told before", async () => {
    const { tasks, authorization, database } = await setup();

    expect((await tasks.describeDescendants(MANAGER, "leaf")).canArchive).toBe(
      true,
    );

    // The role loses the milestone right after the hint was given.
    await authorization.saveRole(
      createRole({
        id: "role-manager",
        name: "Role manager",
        permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
      }),
    );

    await expect(tasks.archive(MANAGER, "leaf")).rejects.toThrow("not allowed");
    await expect(tasks.archiveMilestone(MANAGER, "m1")).rejects.toThrow(
      "not allowed",
    );
    expect(await archivedKeys(database)).toEqual([]);
    expect(await archivedMilestones(database)).toEqual([]);
  });

  it("rejects an unknown milestone and ticket before looking at rights", async () => {
    const { tasks } = await setup();

    await expect(tasks.archiveMilestone(ADMIN, "missing")).rejects.toThrow(
      "Selected milestone does not exist.",
    );
    await expect(tasks.archive(ADMIN, "missing")).rejects.toThrow(
      "does not exist",
    );
  });

  it("lists archived tickets only in the projects where the person may archive", async () => {
    const { tasks } = await setup();

    await tasks.archive(ADMIN, "leaf");
    await tasks.archive(ADMIN, "beta2");

    const keys = async (
      actor: typeof ADMIN,
      archived: "archived" | "all",
    ): Promise<string[]> =>
      (await tasks.findAll(actor, { archived })).map((item) => item.key).sort();

    expect(await keys(ADMIN, "archived")).toEqual(["ALPHA-4", "BETA-2"]);
    expect(await keys(MANAGER, "archived")).toEqual(["ALPHA-4"]);
    // Both projects are visible, but only Beta is in their responsibility.
    expect(await keys(BETA_MANAGER, "archived")).toEqual(["BETA-2"]);
    expect(await keys(BETA_MANAGER, "all")).toEqual([
      "ALPHA-1",
      "ALPHA-2",
      "ALPHA-3",
      "BETA-1",
      "BETA-2",
    ]);
    // Without the right the filter has no effect: only active tickets return.
    expect(await keys(WRITER, "archived")).toEqual([]);
    expect(await keys(WRITER, "all")).toEqual([
      "ALPHA-1",
      "ALPHA-2",
      "ALPHA-3",
    ]);
    expect(
      (await tasks.findAll(WRITER, { archived: "all" })).map(
        (item) => item.key,
      ),
    ).toEqual((await tasks.findAll(WRITER)).map((item) => item.key));
  });

  it("offers the archive filter only to people who may archive somewhere", async () => {
    const { tasks } = await setup();
    const projectIds = ["p1", "p2"];

    expect(await tasks.canArchiveAny(ADMIN, projectIds)).toBe(true);
    expect(await tasks.canArchiveAny(MANAGER, projectIds)).toBe(true);
    expect(await tasks.canArchiveAny(MANAGER, ["p2"])).toBe(false);
    expect(await tasks.canArchiveAny(WRITER, projectIds)).toBe(false);
    expect(await tasks.canArchiveAny(PLAIN_MANAGER, projectIds)).toBe(false);
    expect(await tasks.canArchiveAny(MANAGER, [])).toBe(false);
  });
});
