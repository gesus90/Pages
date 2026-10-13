import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWorkspaceRightsHarness } from "../helpers/workspace-rights";

import type { WorkspaceRightsHarness } from "../helpers/workspace-rights";

describe("PAGE-25 workspaces need a GitHub-linked project", () => {
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

  it("refuses a project without any GitHub integration and stores nothing", async () => {
    const current = await setup();
    await expect(
      current.workspaces.save(current.admin.userId, null, {
        name: "No link",
        path: await current.directory("unlinked"),
        projectId: "unlinked",
      }),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    expect(await current.repository.list()).toEqual([]);
  });

  it("refuses a project whose integration holds no repository address", async () => {
    const current = await setup();
    await current.link("unlinked", "");
    await expect(
      current.workspaces.save(current.admin.userId, null, {
        name: "Empty link",
        path: await current.directory("empty"),
        projectId: "unlinked",
      }),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    expect(await current.repository.list()).toEqual([]);
  });

  it("accepts the project as soon as it has a repository address and shows the link", async () => {
    const current = await setup();
    await current.link("unlinked", "https://github.com/example/unlinked.git");
    const id = await current.workspaces.save(current.admin.userId, null, {
      name: "Linked",
      path: await current.directory("linked"),
      projectId: "unlinked",
    });
    const page = await current.workspaces.page(current.admin.userId);
    expect(page.workspaces[0]).toMatchObject({
      id,
      github: { repoUrl: "https://github.com/example/unlinked.git" },
      isUsable: true,
      reason: null,
    });
    expect(
      page.projects.find((project) => project.id === "unlinked")?.github,
    ).toMatchObject({ repoUrl: "https://github.com/example/unlinked.git" });
  });

  it("does not move a registration to a project without a link", async () => {
    const current = await setup();
    const id = await current.register();
    const registered = (await current.repository.list())[0];
    await expect(
      current.workspaces.save(current.admin.userId, id, {
        name: registered.name,
        path: registered.path,
        projectId: "unlinked",
        revision: registered.revision,
      }),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    expect(await current.repository.list()).toEqual([registered]);
  });

  it("also refuses a plain edit once the project lost its link", async () => {
    const current = await setup();
    const id = await current.register();
    const registered = (await current.repository.list())[0];
    await current.projects.deleteIntegration("project");
    await expect(
      current.workspaces.save(current.admin.userId, id, {
        name: "Renamed",
        path: registered.path,
        projectId: "project",
        revision: registered.revision,
      }),
    ).rejects.toMatchObject({ code: "workspace_project_unsupported" });
    expect(await current.repository.list()).toEqual([registered]);
  });

  it("marks a registration unusable and refuses to resolve it when the project loses its link", async () => {
    const current = await setup();
    const bob = current.bob.id;
    const id = await current.register();
    expect((await current.workspaces.choices(bob))[0]).toMatchObject({
      isUsable: true,
    });
    await current.projects.deleteIntegration("project");
    expect((await current.workspaces.choices(bob))[0]).toMatchObject({
      id,
      isUsable: false,
      reason: "workspace_project_unsupported",
      github: null,
    });
    expect(
      (await current.workspaces.page(current.admin.userId)).workspaces[0],
    ).toMatchObject({
      isUsable: false,
      reason: "workspace_project_unsupported",
      canManage: true,
    });
    await expect(current.workspaces.resolve(bob, id)).rejects.toMatchObject({
      code: "workspace_project_unsupported",
    });
    // The link is the only thing that was missing: restoring it restores use.
    await current.link("project");
    expect(await current.workspaces.resolve(bob, id)).toMatchObject({
      id,
      github: { repoUrl: "https://github.com/example/project" },
    });
  });

  it("removes a registration without touching the project link or the directory", async () => {
    const current = await setup();
    const directory = await current.directory("kept");
    const file = path.join(directory, "work.txt");
    await writeFile(file, "uncommitted local work");
    const id = await current.register({ path: directory });
    const integrationBefore = await current.projects.findIntegration("project");
    await current.workspaces.remove(current.admin.userId, id, 1);
    expect(await current.projects.findIntegration("project")).toEqual(
      integrationBefore,
    );
    expect(await current.repository.list()).toEqual([]);
    expect((await stat(directory)).isDirectory()).toBe(true);
    expect(await readFile(file, "utf8")).toBe("uncommitted local work");
  });
});
