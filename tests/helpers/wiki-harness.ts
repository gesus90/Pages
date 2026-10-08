import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { WikiService } from "@/backend/service/WikiService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { CAPABILITY } from "@/definition/Authorization";

import { createAccess, createRole } from "./authorization";

import type { Database } from "@/backend/database/Database";
import type { Capability } from "@/definition/Authorization";
import type { User } from "@/definition/User";
import type { CreateWikiPageInput } from "@/backend/service/WikiService";

/** Options of {@link WikiHarness.addUser}. */
export interface HarnessUserOptions {
  readonly departments?: readonly string[];
  readonly capabilities?: readonly Capability[];
  readonly isAdmin?: boolean;
  readonly mode?: "admin" | "role";
  /** Whether project access follows the departments of the account. */
  readonly departmentBound?: boolean;
  readonly displayName?: string;
}

/** A wiki on a real in-memory database with real policy services. */
export interface WikiHarness {
  readonly database: Database;
  readonly repository: WikiRepository;
  readonly service: WikiService;
  /** Directory that holds the stored attachments of this wiki. */
  readonly filesDirectory: string;
  addUser(id: string, options?: HarnessUserOptions): Promise<User>;
  addDepartment(id: string): Promise<void>;
  addProject(id: string, departmentIds?: readonly string[]): Promise<void>;
  addMilestone(id: string, projectId: string): Promise<void>;
  addEpic(
    id: string,
    projectId: string,
    departmentId?: string | null,
  ): Promise<void>;
}

/** Builds the default input of a root page in the whole instance. */
export function pageInput(
  overrides: Partial<CreateWikiPageInput> = {},
): CreateWikiPageInput {
  return {
    anchors: [],
    content: "",
    icon: null,
    isTemplate: false,
    parentId: null,
    projectId: null,
    scope: "instance",
    templateId: null,
    title: "Page",
    ...overrides,
  };
}

/**
 * Builds a wiki harness around a migrated database.
 *
 * @param database - Migrated database of the running test.
 * @returns Helpers to add accounts and projects, and the wiki service.
 */
export function createWikiHarness(database: Database): WikiHarness {
  const filesDirectory = mkdtempSync(path.join(tmpdir(), "pages-wiki-files-"));
  const authorization = new AuthorizationRepository(database);
  const permissionService = new PermissionService((id) =>
    authorization.snapshot().then((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.userId === id);

      if (!account) {
        throw new Error(`Unknown test account ${id}.`);
      }

      return account;
    }),
  );
  const projectService = new ProjectService(
    new ProjectRepository(database),
    permissionService,
    undefined,
    new ServerCache(),
  );
  const repository = new WikiRepository(database);

  return {
    database,
    repository,
    filesDirectory,
    service: new WikiService(
      repository,
      projectService,
      permissionService,
      new WikiFileStore(filesDirectory),
    ),
    async addUser(id, options = {}) {
      const displayName = options.displayName ?? id;

      await authorization.users().insert({
        displayName,
        id,
        passwordHash: "hash",
        role: "employee",
        username: id,
      });
      await authorization.saveRole(
        createRole({
          departmentBound: options.departmentBound ?? true,
          id: `role-${id}`,
          name: `Role ${id}`,
          permissions: options.capabilities ?? [CAPABILITY.WRITE],
        }),
      );
      await authorization.saveAccount(
        createAccess({
          departments: options.departments ?? [],
          isAdmin: options.isAdmin ?? false,
          managedDepartments: [],
          mode: options.mode ?? "role",
          role: createRole({
            departmentBound: options.departmentBound ?? true,
            id: `role-${id}`,
            name: `Role ${id}`,
            permissions: options.capabilities ?? [CAPABILITY.WRITE],
          }),
          userId: id,
        }),
      );

      return {
        displayName,
        id,
        isActive: true,
        mustChangePassword: false,
        role: "employee",
        username: id,
      };
    },
    async addDepartment(id) {
      await database.execute(
        "INSERT INTO departments (id, name) VALUES ($id, $name);",
        { id, name: `Department ${id}` },
      );
    },
    async addProject(id, departmentIds = []) {
      await database.execute(
        "INSERT INTO projects (id, name, owner_id) VALUES ($id, $name, 'owner');",
        { id, name: `Project ${id}` },
      );

      for (const departmentId of departmentIds) {
        await database.execute(
          "INSERT INTO project_departments (project_id, department_id) VALUES ($project_id, $department_id);",
          { department_id: departmentId, project_id: id },
        );
      }
    },
    async addMilestone(id, projectId) {
      await database.execute(
        "INSERT INTO milestones (id, project_id, name) VALUES ($id, $project_id, $name);",
        { id, name: `Milestone ${id}`, project_id: projectId },
      );
    },
    async addEpic(id, projectId, departmentId = null) {
      await database.execute(
        `
          INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, department_id)
          VALUES ($id, $project_id, $key, 1, 'epic', $title, 'status-todo', 'owner', $department_id);
        `,
        {
          department_id: departmentId,
          id,
          key: `${projectId}-${id}`.toUpperCase(),
          project_id: projectId,
          title: `Epic ${id}`,
        },
      );
    },
  };
}
