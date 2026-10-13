import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";

vi.mock("@/backend/service/agents/AgentParameterBinding", { spy: true });

import { createExecutionPlanHarness } from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A10 workspace metadata and reference failure regression", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
  });
  async function setup(): Promise<ExecutionPlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }

  it("does not select a CLI directory from a binder reference that skipped live workspace resolution", async () => {
    const current = await setup();
    vi.mocked(bindAgentParameters).mockResolvedValueOnce({
      markdown: "Missing live reference",
      directory: null,
      wikiVersions: {},
      values: { root: { type: "workspace", workspaceId: current.workspaceId } },
    });
    const prepared = await current.parameters.prepare(
      current.bob.id,
      {
        agentId: current.agentId,
        personalAgentId: null,
        workspaceId: current.workspaceId,
      },
      {},
      {
        ...emptyAgentConfiguration("system"),
        directoryParameter: "root",
        parameters: [
          {
            name: "root",
            type: "workspace",
            description: "",
            isRequired: true,
            defaultValue: null,
          },
        ],
      },
    );
    expect(prepared.directory).toBeNull();
    expect(prepared.references).toEqual([]);
    expect(prepared.workspace.id).toBe(current.workspaceId);
  });

  it("keeps admin metadata complete while hiding deleted projects from users and preserving unexpected path failures", async () => {
    const current = await setup();
    const page = await current.workspaces.page(current.admin.userId);
    expect(page.projects[0]).toMatchObject({
      id: "project",
      name: "Project project",
    });
    vi.spyOn(current.projects, "findAll").mockResolvedValueOnce([]);
    expect(await current.workspaces.choices(current.bob.id)).toEqual([]);
    const projects = await current.projects.findAll();
    vi.spyOn(current.projects, "findAll").mockResolvedValueOnce([]);
    expect(
      (await current.workspaces.page(current.admin.userId)).workspaces[0],
    ).toMatchObject({
      projectName: "project",
      github: null,
      reason: "workspace_access_denied",
    });
    expect(projects).toHaveLength(1);
    const paths = new AgentWorkspacePath({
      roots: [path.join(current.root, "approved")],
      protectedDirectory: path.join(current.root, "instance"),
    });
    vi.spyOn(paths, "resolve").mockRejectedValue(
      new Error("filesystem failure"),
    );
    const service = new AgentWorkspaceService({
      workspaces: current.workspaceRepository,
      authorization: current.authorization,
      projects: current.projects,
      paths,
    });
    await expect(service.page(current.bob.id)).rejects.toThrow(
      "filesystem failure",
    );
    await expect(
      current.workspaces.save(current.admin.userId, "missing", {
        name: "Missing",
        path: path.join(current.root, "approved", "three"),
        projectId: "project",
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "workspace_not_found" });
  });

  it("rejects approved-root files, unknown project registrations and revoked wiki readers", async () => {
    const current = await setup();
    const file = path.join(current.root, "root-file");
    await writeFile(file, "This is not a root directory");
    const paths = new AgentWorkspacePath({
      roots: [file],
      protectedDirectory: path.join(current.root, "instance"),
    });
    await expect(
      paths.inspect(path.join(current.root, "approved", "one")),
    ).rejects.toMatchObject({ code: "workspace_path_invalid" });
    await expect(
      current.workspaces.save(current.admin.userId, null, {
        name: "Invalid project",
        path: path.join(current.root, "approved", "three"),
        projectId: "missing",
      }),
    ).rejects.toMatchObject({ code: "workspace_access_denied" });
    await expect(
      current.parameters.requireWiki("missing", current.page.id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    const bound = await current.parameters.prepare(
      current.bob.id,
      {
        agentId: current.agentId,
        personalAgentId: null,
        workspaceId: current.workspaceId,
      },
      {},
    );
    const resolved = await current.profiles.resolveDefinition(current.bob.id, {
      agentId: current.agentId,
      personalAgentId: null,
      projectId: "project",
    });
    vi.spyOn(current.workspaces, "resolve").mockResolvedValue(bound.workspace);
    vi.spyOn(current.profiles, "resolveDefinition").mockResolvedValue(resolved);
    const snapshot = await current.authorization.snapshot();
    vi.spyOn(current.authorization, "snapshot").mockResolvedValue({
      ...snapshot,
      accounts: snapshot.accounts.map((entry) =>
        entry.userId === current.bob.id ? { ...entry, isActive: false } : entry,
      ),
    });
    await expect(
      current.parameters.prepare(
        current.bob.id,
        {
          agentId: current.agentId,
          personalAgentId: null,
          workspaceId: current.workspaceId,
        },
        {},
        {
          ...emptyAgentConfiguration("system"),
          markdown: "{{wiki.markdown}}",
          parameters: [
            {
              name: "wiki",
              type: "wiki",
              description: "",
              isRequired: true,
              defaultValue: { type: "wiki", pageId: current.page.id },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });
});
