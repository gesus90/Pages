import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import {
  controlExecution,
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";
import { createWorkspaceRightsHarness } from "../helpers/workspace-rights";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";
import type { WorkspaceRightsHarness } from "../helpers/workspace-rights";

/** Settles an operation into the error it throws, so two failures can be compared. */
async function failure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("The operation was expected to fail.");
}

describe("PAGE-25 workspace visibility follows project access", () => {
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

  it("shows a workspace to everyone who can open its project and to nobody else", async () => {
    const current = await setup();
    const id = await current.register({ projectId: "engineering-project" });
    const engineer = await current.person("engineer", {
      isDepartmentBound: true,
      departments: ["engineering"],
    });
    const designer = await current.person("designer", {
      isDepartmentBound: true,
      departments: ["design"],
    });
    const unbound = await current.person("unbound");
    for (const userId of [engineer, unbound]) {
      const page = await current.workspaces.page(userId);
      expect(page.workspaces.map((entry) => entry.id)).toEqual([id]);
      expect(
        (await current.workspaces.choices(userId)).map((entry) => entry.id),
      ).toEqual([id]);
      expect((await current.workspaces.resolve(userId, id)).projectId).toBe(
        "engineering-project",
      );
    }
    expect((await current.workspaces.page(designer)).workspaces).toEqual([]);
    expect(await current.workspaces.choices(designer)).toEqual([]);
    await expect(
      current.workspaces.choices(designer, "engineering-project"),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    await expect(
      current.workspaces.resolve(designer, id),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
  });

  it("reads only the projects that carry workspaces when it offers choices", async () => {
    const current = await setup();
    await current.register({ projectId: "shared" });
    const findAll = vi.spyOn(current.projects, "findAll");
    const findById = vi.spyOn(current.projects, "findById");
    const choices = await current.workspaces.choices(current.bob.id);
    expect(choices.map((entry) => entry.projectId)).toEqual(["shared"]);
    expect(findAll).not.toHaveBeenCalled();
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it("treats a workspace of an inaccessible project like a missing one on every direct call", async () => {
    const current = await setup();
    const hidden = await current.register({ projectId: "engineering-project" });
    const designer = await current.person("designer", {
      isDepartmentBound: true,
      departments: ["design"],
    });
    const registered = (await current.repository.list())[0];
    const missing = "00000000-0000-4000-8000-000000000000";
    const calls = [
      (id: string) => current.workspaces.usages(designer, id),
      (id: string) => current.workspaces.remove(designer, id, 1),
      (id: string) =>
        current.workspaces.save(designer, id, {
          name: "Probe",
          path: registered.path,
          projectId: "project",
          revision: 1,
        }),
    ];
    for (const call of calls) {
      const forHidden = await failure(call(hidden));
      const forMissing = await failure(call(missing));
      expect(forHidden).toMatchObject({ code: "workspace_not_found" });
      expect(forHidden).toEqual(forMissing);
    }
    const resolveHidden = await failure(
      current.workspaces.resolve(designer, hidden),
    );
    expect(resolveHidden).toEqual(
      await failure(current.workspaces.resolve(designer, missing)),
    );
    const createInHidden = await failure(
      current.workspaces.save(designer, null, {
        name: "Probe",
        path: await current.directory("probe"),
        projectId: "engineering-project",
      }),
    );
    expect(createInHidden).toMatchObject({ code: "workspace_access_denied" });
    expect(createInHidden).toEqual(
      await failure(
        current.workspaces.save(designer, null, {
          name: "Probe",
          path: await current.directory("probe"),
          projectId: "no-such-project",
        }),
      ),
    );
    for (const error of [resolveHidden, createInHidden])
      expect(String(error)).not.toContain(registered.path);
    expect(await current.repository.list()).toEqual([registered]);
  });

  it("knows no extra release for persons, groups or departments", async () => {
    const current = await setup();
    const designer = await current.person("designer", {
      isDepartmentBound: true,
      departments: ["design"],
    });
    await new UserGroupRepository(getDatabase()).save({
      id: "team",
      name: "Team",
      memberIds: [designer],
    });
    const id = await current.workspaces.save(current.admin.userId, null, {
      name: "Granted?",
      path: await current.directory("granted"),
      projectId: "engineering-project",
      // Such grants existed before; the server ignores them completely.
      targets: [
        { kind: "person", targetId: designer },
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "design" },
      ],
    });
    expect(Object.keys((await current.repository.list())[0])).not.toContain(
      "targets",
    );
    expect((await current.workspaces.page(designer)).workspaces).toEqual([]);
    await expect(
      current.workspaces.resolve(designer, id),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
  });

  it("hides the workspaces of an archived project from everyone but the administrator", async () => {
    const current = await setup();
    const id = await current.register({ projectId: "shared" });
    await current.projects.archive("shared");
    expect(await current.workspaces.choices(current.bob.id)).toEqual([]);
    await expect(
      current.workspaces.resolve(current.bob.id, id),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    const page = await current.workspaces.page(current.bob.id);
    expect(page.workspaces).toEqual([]);
    const adminView = (await current.workspaces.page(current.admin.userId))
      .workspaces[0];
    expect(adminView).toMatchObject({
      id,
      isUsable: false,
      reason: "workspace_access_denied",
      canManage: true,
    });
  });

  it("lets only the administrator clean up a registration whose project is gone", async () => {
    const current = await setup();
    const lead = await current.person("lead", {
      projectRoles: { shared: "manager" },
    });
    const id = await current.register({ projectId: "shared" });
    await current.projects.archive("shared");
    await expect(current.workspaces.usages(lead, id)).rejects.toMatchObject({
      code: "workspace_not_found",
    });
    await expect(current.workspaces.remove(lead, id, 1)).rejects.toMatchObject({
      code: "workspace_not_found",
    });
    expect(await current.repository.list()).toHaveLength(1);
    await expect(
      current.workspaces.usages(current.admin.userId, id),
    ).resolves.toEqual([]);
    await current.workspaces.remove(current.admin.userId, id, 1);
    expect(await current.repository.list()).toEqual([]);
  });
});

describe("PAGE-25 workspace choice in the agent planning", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup(): Promise<ExecutionPlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }

  it("offers a person only the usable workspaces of accessible projects", async () => {
    const current = await setup();
    await current.wiki.addDepartment("engineering");
    await current.wiki.addProject("restricted", ["engineering"]);
    await current.projects.upsertIntegration("restricted", {
      repoUrl: "https://github.com/example/restricted",
      repoName: "example/restricted",
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
    const restricted = await current.workspaces.save(
      current.admin.userId,
      null,
      {
        name: "Restricted",
        path: path.join(current.root, "approved", "three"),
        projectId: "restricted",
      },
    );
    await current.wiki.addUser("dave", {
      departmentBound: true,
      departments: ["design"],
    });
    const forBob = await current.service.page(current.bob.id, {
      planId: null,
      workspaceId: null,
    });
    expect(forBob.workspaces.map((entry) => entry.name).sort()).toEqual([
      "One",
      "Restricted",
      "Two",
    ]);
    expect(forBob.workspaces.every((entry) => entry.isUsable)).toBe(true);
    const forDave = await current.service.page("dave", {
      planId: null,
      workspaceId: null,
    });
    expect(forDave.workspaces.map((entry) => entry.name)).toEqual([
      "One",
      "Two",
    ]);
    await expect(
      current.service.page("dave", { planId: null, workspaceId: restricted }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.sources("dave", restricted),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.save(
        "dave",
        null,
        executionPlan(restricted, current.agentId),
      ),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    await expect(
      current.service.save(
        "dave",
        null,
        executionPlan("/not/a/registered/id", current.agentId),
      ),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    expect(
      await current.service.save(
        "dave",
        null,
        executionPlan(current.workspaceId, current.agentId),
      ),
    ).toEqual(expect.any(String));
  });

  it("keeps a started run readable and stoppable after its project lost the GitHub link", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "B"].map((name) => executionStep(name, current.agentId)),
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    await current.projects.deleteIntegration("project");
    // A new start is refused, but what already runs can still be read and stopped.
    expect(await current.service.run(current.bob.id, run.id)).toMatchObject({
      id: run.id,
      status: "running",
    });
    const requested = await current.service.stop(current.bob.id, run.id);
    expect(requested.steps[0]).toMatchObject({ cancellation: "requested" });
    pending.get("A")?.reject(new AgentPlanCancelledError());
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "cancelled",
      ),
    );
    await expect(
      current.service.play(current.bob.id, id, 1),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    const page = await current.service.page(current.bob.id, {
      planId: id,
      workspaceId: null,
    });
    expect(page.runs.map((entry) => entry.id)).toEqual([run.id]);
  });

  it("lists an unavailable workspace as unusable and refuses it in a plan", async () => {
    const current = await setup();
    const plan = executionPlan(current.workspaceId, current.agentId);
    await current.projects.deleteIntegration("project");
    const unlinked = await current.service.page(current.bob.id, {
      planId: null,
      workspaceId: null,
    });
    expect(unlinked.workspaces).toHaveLength(2);
    for (const entry of unlinked.workspaces)
      expect(entry).toMatchObject({
        isUsable: false,
        reason: "workspace_project_unsupported",
      });
    await expect(
      current.service.save(current.bob.id, null, plan),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    await current.projects.upsertIntegration("project", {
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
    const first = (await current.workspaceRepository.list()).find(
      (entry) => entry.id === current.workspaceId,
    );
    if (!first) throw new Error("Missing workspace fixture");
    await rename(first.path, `${first.path}-moved`);
    await mkdir(first.path);
    const changed = await current.workspaces.choices(current.bob.id);
    expect(changed.find((entry) => entry.id === first.id)).toMatchObject({
      isUsable: false,
      reason: "workspace_path_changed",
    });
    expect(changed.find((entry) => entry.id !== first.id)).toMatchObject({
      isUsable: true,
    });
    await expect(
      current.service.save(current.bob.id, null, plan),
    ).rejects.toMatchObject({ code: "workspace_path_changed" });
    expect(
      await current.service.save(
        current.bob.id,
        null,
        executionPlan(current.secondWorkspaceId, current.agentId),
      ),
    ).toEqual(expect.any(String));
  });
});
