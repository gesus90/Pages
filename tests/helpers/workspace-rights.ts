import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { CAPABILITY } from "@/definition/Authorization";

import { createAssistantHarness } from "./text-assistant";

import type { Database } from "@/backend/database/Database";
import type { AgentWorkspaceInput } from "@/definition/AgentWorkspace";
import type { Capability } from "@/definition/Authorization";
import type { ProjectRole } from "@/definition/Project";

type Harness = Awaited<ReturnType<typeof createAssistantHarness>>;

interface PersonOptions {
  readonly capabilities?: readonly Capability[];
  readonly departments?: readonly string[];
  readonly managedDepartments?: readonly string[];
  readonly isDepartmentBound?: boolean;
  readonly isAdmin?: boolean;
  readonly mode?: "admin" | "role";
  readonly allProjects?: boolean;
  readonly projectRoles?: Readonly<Record<string, ProjectRole>>;
}

/** Everything the workspace rights tests need: real services, real DuckDB, disposable directories. */
export interface WorkspaceRightsHarness extends Harness {
  readonly root: string;
  readonly projects: ProjectRepository;
  readonly repository: AgentWorkspaceRepository;
  readonly workspaces: AgentWorkspaceService;
  /** Creates an existing directory below the approved root and returns its path. */
  directory(name: string): Promise<string>;
  /** Registers a workspace as the administrator, or as `userId`, and returns its identifier. */
  register(
    overrides?: Partial<AgentWorkspaceInput>,
    userId?: string,
  ): Promise<string>;
  /** Stores a GitHub link for the project. */
  link(projectId: string, repoUrl?: string): Promise<void>;
  /** Adds an account with the given capabilities, scope and project roles. */
  person(id: string, options?: PersonOptions): Promise<string>;
  dispose(): Promise<void>;
}

/**
 * Builds the people of the PAGE-25 acceptance matrix around real services.
 *
 * @param database - Migrated database of the running test.
 * @remarks
 * Projects: `project` (open, GitHub), `engineering-project` (department
 * `engineering`, GitHub), `unlinked` (open, no GitHub) and `shared` (open,
 * GitHub). Accounts are added per test with {@link WorkspaceRightsHarness.person}.
 */
export async function createWorkspaceRightsHarness(
  database: Database,
): Promise<WorkspaceRightsHarness> {
  const base = await createAssistantHarness(database);
  await base.authorization.saveAccount(base.admin);
  const root = await mkdtemp(path.join(tmpdir(), "pages-workspace-rights-"));
  await mkdir(path.join(root, "instance"));
  await mkdir(path.join(root, "approved"));
  const projects = new ProjectRepository(database);
  const repository = new AgentWorkspaceRepository(database);
  const workspaces = new AgentWorkspaceService({
    workspaces: repository,
    projects,
    authorization: base.authorization,
    paths: new AgentWorkspacePath({
      roots: [path.join(root, "approved")],
      protectedDirectory: path.join(root, "instance"),
    }),
  });
  await base.wiki.addDepartment("engineering");
  await base.wiki.addDepartment("design");
  await base.wiki.addProject("engineering-project", ["engineering"]);
  await base.wiki.addProject("unlinked");
  await base.wiki.addProject("shared");
  let sequence = 0;
  const harness: WorkspaceRightsHarness = {
    ...base,
    root,
    projects,
    repository,
    workspaces,
    async directory(name) {
      const directory = path.join(root, "approved", name);
      await mkdir(directory, { recursive: true });
      return directory;
    },
    async register(overrides = {}, userId = base.admin.userId) {
      sequence += 1;
      const name = `directory-${sequence}`;
      return workspaces.save(userId, null, {
        name: `Workspace ${sequence}`,
        path: overrides.path ?? (await harness.directory(name)),
        projectId: "project",
        ...overrides,
      });
    },
    async link(projectId, repoUrl = `https://github.com/example/${projectId}`) {
      await projects.upsertIntegration(projectId, {
        repoUrl,
        repoName: repoUrl === "" ? null : `example/${projectId}`,
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
    },
    async person(id, options = {}) {
      const user = await base.wiki.addUser(id, {
        capabilities: options.capabilities ?? [CAPABILITY.WRITE],
        departments: options.departments ?? [],
        departmentBound: options.isDepartmentBound ?? false,
        isAdmin: options.isAdmin ?? false,
        mode: options.mode ?? "role",
      });
      const account = (await base.authorization.snapshot()).accounts.find(
        (entry) => entry.userId === user.id,
      );
      if (!account) throw new Error("Missing account fixture");
      await base.authorization.saveAccount({
        ...account,
        managedDepartments: options.managedDepartments ?? [],
        allProjects: options.allProjects ?? false,
      });
      for (const [projectId, role] of Object.entries(
        options.projectRoles ?? {},
      ))
        await projects.addMember(projectId, user.id, role);
      return user.id;
    },
    async dispose() {
      await rm(root, { recursive: true, force: true });
      await rm(base.wiki.filesDirectory, { recursive: true, force: true });
    },
  };
  for (const projectId of ["project", "engineering-project", "shared"])
    await harness.link(projectId);
  return harness;
}
