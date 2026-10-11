import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  symlink,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createAccess, createRole } from "../helpers/authorization";
import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type { AgentWorkspaceInput } from "@/definition/AgentWorkspace";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";

async function setup(
  database: Database,
  root: string,
): Promise<
  Awaited<ReturnType<typeof createAssistantHarness>> & {
    readonly workspaces: AgentWorkspaceService;
    readonly workspaceRepository: AgentWorkspaceRepository;
    readonly projects: ProjectRepository;
    readonly groups: UserGroupRepository;
    readonly profiles: AgentProfileService;
    readonly parameters: AgentParameterService;
  }
> {
  const harness = await createAssistantHarness(database);
  await harness.authorization.saveAccount(harness.admin);
  const projects = new ProjectRepository(database);
  const groups = new UserGroupRepository(database);
  const workspaceRepository = new AgentWorkspaceRepository(database);
  const workspaces = new AgentWorkspaceService({
    workspaces: workspaceRepository,
    projects,
    groups,
    authorization: harness.authorization,
    paths: new AgentWorkspacePath({
      roots: [path.join(root, "approved")],
      protectedDirectory: path.join(root, "instance"),
    }),
  });
  const content = new AgentContentAccess(projects, harness.wiki.repository);
  const profiles = new AgentProfileService({
    profiles: new AgentProfileRepository(database),
    connections: harness.connections,
    authorization: harness.authorization,
    groups,
    content,
    workspaces,
    operations: new AgentOperationRegistry(),
  });
  return {
    ...harness,
    workspaces,
    workspaceRepository,
    projects,
    groups,
    profiles,
    parameters: new AgentParameterService({
      profiles,
      workspaces,
      content,
      authorization: harness.authorization,
    }),
  };
}

function registration(
  root: string,
  userId: string,
  overrides: Partial<AgentWorkspaceInput> = {},
): AgentWorkspaceInput {
  return {
    name: "Development",
    path: path.join(root, "approved", "one"),
    projectId: "project",
    targets: [{ kind: "person", targetId: userId }],
    ...overrides,
  };
}

async function saveIntegration(
  projects: ProjectRepository,
  repoUrl: string,
): Promise<void> {
  await projects.upsertIntegration("project", {
    repoUrl,
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
}

describe("A10.3 local workspace registration, rights and parameter preparation", () => {
  const getDatabase = useMigratedDatabase();
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-workspaces-"));
    for (const directory of [
      "approved/one",
      "approved/two",
      "approved/three",
      "instance",
      "outside",
    ])
      await mkdir(path.join(root, directory), { recursive: true });
  });
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("registers an existing canonical directory, derives live GitHub metadata and unregisters without altering files", async () => {
    const { workspaces, workspaceRepository, projects, admin, bob } =
      await setup(getDatabase(), root);
    const file = path.join(root, "approved", "one", "existing.txt");
    await writeFile(file, "uncommitted local work");
    const before = await stat(file);
    await saveIntegration(projects, "https://github.com/example/project.git");
    const alias = path.join(root, "approved", "alias");
    await symlink(path.join(root, "approved", "one"), alias);
    const id = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, { path: alias }),
    );
    const resolved = await workspaces.resolve(bob.id, id);
    expect(resolved.path).toBe(path.join(root, "approved", "one"));
    expect(resolved.github?.repoUrl).toBe(
      "https://github.com/example/project.git",
    );
    const page = await workspaces.page(bob.id);
    expect(page.workspaces[0]).toMatchObject({
      id,
      canManage: false,
      targets: [],
    });
    expect(JSON.stringify(page)).not.toMatch(
      /synthetic-ciphertext|tokenHash|registeredBy|directoryIdentity/,
    );
    await saveIntegration(projects, "https://github.com/example/renamed.git");
    expect((await workspaces.resolve(bob.id, id)).github?.repoUrl).toBe(
      "https://github.com/example/renamed.git",
    );
    await expect(workspaces.resolve(admin.userId, id)).rejects.toMatchObject({
      code: "workspace_access_denied",
    });
    await expect(
      workspaces.save(bob.id, null, registration(root, bob.id)),
    ).rejects.toMatchObject({ name: "AgentAccessDeniedError" });
    await workspaces.remove(admin.userId, id, 1);
    expect(await workspaceRepository.list()).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("uncommitted local work");
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it("rechecks group and department usage, revocation, inactivity and project scope without management bypass", async () => {
    const { workspaces, admin, bob, authorization, groups, wiki } = await setup(
      getDatabase(),
      root,
    );
    await wiki.addDepartment("engineering");
    await wiki.addDepartment("other");
    await wiki.addProject("restricted", ["engineering"]);
    await authorization.saveRole(
      createRole({ id: "scoped", permissions: [], departmentBound: true }),
    );
    const account = createAccess({
      userId: bob.id,
      role: createRole({
        id: "scoped",
        permissions: [],
        departmentBound: true,
      }),
      departments: ["engineering"],
      managedDepartments: ["other"],
    });
    await authorization.saveAccount(account);
    await groups.save({ id: "team", name: "Team", memberIds: [bob.id] });
    const groupId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, {
        projectId: "restricted",
        targets: [{ kind: "group", targetId: "team" }],
      }),
    );
    const departmentId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, {
        path: path.join(root, "approved", "two"),
        projectId: "restricted",
        targets: [{ kind: "department", targetId: "engineering" }],
      }),
    );
    expect(
      (await workspaces.choices(bob.id, "restricted"))
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([groupId, departmentId].sort());
    await groups.save({ id: "team", name: "Team", memberIds: [] });
    await expect(workspaces.resolve(bob.id, groupId)).rejects.toMatchObject({
      code: "workspace_access_denied",
    });
    expect(await workspaces.resolve(bob.id, departmentId)).toMatchObject({
      projectId: "restricted",
    });
    await authorization.saveAccount({
      ...account,
      departments: ["other"],
      managedDepartments: ["engineering"],
    });
    expect((await workspaces.page(bob.id)).workspaces).toEqual([]);
    await expect(
      workspaces.choices(bob.id, "restricted"),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    const personalId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, {
        path: path.join(root, "approved", "three"),
        projectId: "restricted",
      }),
    );
    await expect(workspaces.resolve(bob.id, personalId)).rejects.toMatchObject({
      code: "workspace_access_denied",
    });
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = $id;",
      { id: bob.id },
    );
    await expect(workspaces.resolve(bob.id, personalId)).rejects.toMatchObject({
      code: "workspace_access_denied",
    });
  });

  it("rejects unapproved, traversing, missing, non-directory, protected and symlink-escaping paths and overlapping registrations", async () => {
    const { workspaces, admin, bob } = await setup(getDatabase(), root);
    const paths = new AgentWorkspacePath({
      roots: [],
      protectedDirectory: path.join(root, "instance"),
    });
    await expect(
      paths.inspect(path.join(root, "approved", "one")),
    ).rejects.toMatchObject({ code: "workspace_roots_missing" });
    const blocked = new AgentWorkspacePath({
      roots: [root],
      protectedDirectory: path.join(root, "instance"),
    });
    await expect(
      blocked.inspect(path.join(root, "instance")),
    ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
    await expect(blocked.inspect(root)).rejects.toMatchObject({
      code: "workspace_path_outside_roots",
    });
    await writeFile(path.join(root, "approved", "file"), "preserved");
    await symlink(
      path.join(root, "outside"),
      path.join(root, "approved", "escape"),
    );
    for (const directory of [
      "relative",
      "/",
      `${root}/approved/../outside`,
      path.join(root, "approved", "missing"),
      path.join(root, "approved", "file"),
      path.join(root, "outside"),
      path.join(root, "approved", "escape"),
    ])
      await expect(
        workspaces.save(
          admin.userId,
          null,
          registration(root, bob.id, { path: directory }),
        ),
      ).rejects.toHaveProperty("code");
    await expect(
      workspaces.save(
        admin.userId,
        null,
        registration(root, bob.id, {
          targets: [{ kind: "person", targetId: "missing" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "profile_target_invalid" });
    await expect(
      workspaces.save(admin.userId, null, {
        ...registration(root, bob.id),
        targets: [{ kind: "system", targetId: "agent" }],
      }),
    ).rejects.toMatchObject({ code: "workspace_invalid" });
    await workspaces.save(admin.userId, null, registration(root, bob.id));
    await mkdir(path.join(root, "approved", "one", "nested"));
    for (const directory of [
      path.join(root, "approved", "one"),
      path.join(root, "approved", "one", "nested"),
      path.join(root, "approved"),
    ])
      await expect(
        workspaces.save(
          admin.userId,
          null,
          registration(root, bob.id, { path: directory }),
        ),
      ).rejects.toMatchObject({ code: "workspace_path_conflict" });
    expect(await readFile(path.join(root, "approved", "file"), "utf8")).toBe(
      "preserved",
    );
  });

  it("fails after directory replacement or loss of permissions and protects stale edits and removal", async () => {
    const { workspaces, workspaceRepository, admin, bob } = await setup(
      getDatabase(),
      root,
    );
    const proposed = registration(root, bob.id);
    const id = await workspaces.save(admin.userId, null, proposed);
    await workspaces.save(admin.userId, id, {
      ...proposed,
      name: "Renamed",
      revision: 1,
    });
    await expect(
      workspaces.save(admin.userId, id, { ...proposed, revision: 1 }),
    ).rejects.toMatchObject({ code: "workspace_conflict" });
    await expect(workspaces.remove(admin.userId, id, 1)).rejects.toMatchObject({
      code: "workspace_conflict",
    });
    await chmod(proposed.path, 0o500);
    await expect(workspaces.resolve(bob.id, id)).rejects.toMatchObject({
      code: "workspace_path_unavailable",
    });
    await chmod(proposed.path, 0o700);
    await rename(proposed.path, `${proposed.path}-original`);
    await mkdir(proposed.path);
    await expect(workspaces.resolve(bob.id, id)).rejects.toMatchObject({
      code: "workspace_path_changed",
    });
    expect((await workspaces.choices(bob.id))[0]).toMatchObject({
      isUsable: false,
      reason: "workspace_path_changed",
    });
    expect((await workspaceRepository.list())[0].revision).toBe(2);
  });

  it("binds defaults and explicit workspace IDs to a real directory contract and current Wiki markdown, with project and reference checks", async () => {
    const { workspaces, profiles, parameters, admin, bob, page, wiki } =
      await setup(getDatabase(), root);
    const targets = [
      { kind: "person", targetId: admin.userId },
      { kind: "person", targetId: bob.id },
    ] as const;
    const workspaceId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, { targets }),
    );
    const secondId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, {
        targets,
        path: path.join(root, "approved", "two"),
      }),
    );
    await wiki.addProject("different");
    const foreignId = await workspaces.save(
      admin.userId,
      null,
      registration(root, bob.id, {
        targets,
        projectId: "different",
        path: path.join(root, "approved", "three"),
      }),
    );
    const configuration: AgentConfiguration = {
      ...emptyAgentConfiguration("system"),
      markdown: "Use {{workspace.path}} for {{task.markdown}}.",
      directoryParameter: "workspace",
      sharing: { isGlobal: true, targets: [] },
      parameters: [
        {
          name: "workspace",
          type: "workspace",
          description: "Directory",
          isRequired: true,
          defaultValue: { type: "workspace", workspaceId },
        },
        {
          name: "task",
          type: "wiki",
          description: "Task",
          isRequired: true,
          defaultValue: { type: "wiki", pageId: page.id },
        },
      ],
    };
    const proposed = {
      name: "Worker",
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
      isActive: true,
      purposes: ["agent"],
      targets: [{ kind: "system", targetId: "agent" }],
      configuration,
    };
    const agentId = await profiles.save(admin, null, proposed);
    const selection = { agentId, workspaceId, personalAgentId: null };
    const bound = await parameters.prepare(bob.id, selection, {});
    expect(bound.directory).toMatchObject({
      id: workspaceId,
      path: path.join(root, "approved", "one"),
      projectId: "project",
    });
    expect(bound.parameters.directory).toBe(bound.directory?.path);
    expect(bound.parameters.markdown).toContain("Original page");
    expect(bound.parameters.wikiVersions.task).toBeDefined();
    const overridden = await parameters.prepare(bob.id, selection, {
      workspace: { type: "workspace", workspaceId: secondId },
    });
    expect(overridden.directory?.path).toBe(path.join(root, "approved", "two"));
    await expect(
      parameters.prepare(bob.id, selection, {
        workspace: { type: "workspace", workspaceId: foreignId },
      }),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    await expect(
      parameters.prepare(bob.id, selection, {
        workspace: { type: "workspace", workspaceId: "/forged/path" },
      }),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    expect(
      (await profiles.list(admin)).find((entry) => entry.id === agentId)
        ?.configuration,
    ).toEqual(configuration);
    expect(await workspaces.usages(admin.userId, workspaceId)).toEqual([
      { id: agentId, name: "Worker" },
    ]);
    await expect(
      workspaces.remove(admin.userId, workspaceId, 1),
    ).rejects.toMatchObject({ code: "workspace_in_use" });
    await expect(
      workspaces.save(admin.userId, workspaceId, {
        ...registration(root, bob.id, { targets }),
        revision: 1,
        projectId: "different",
      }),
    ).rejects.toMatchObject({ code: "workspace_in_use" });
    await profiles.save(admin, agentId, {
      ...proposed,
      revision: 1,
      configuration: { ...configuration, directoryParameter: null },
    });
    const promptOnly = await parameters.prepare(bob.id, selection, {});
    expect(promptOnly.parameters.markdown).toContain(
      path.join(root, "approved", "one"),
    );
    expect(promptOnly.directory).toBeNull();
    expect(promptOnly.parameters.directory).toBeNull();
    await workspaces.save(admin.userId, workspaceId, {
      ...registration(root, admin.userId),
      revision: 1,
    });
    await expect(
      parameters.prepare(bob.id, selection, {}),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
  });
});
