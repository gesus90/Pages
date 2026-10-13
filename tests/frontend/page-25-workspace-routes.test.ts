import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services.current,
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader as choicesLoader } from "@/app/routes/agent-workspace-choices";
import { action, loader } from "@/app/routes/agent-workspaces";

import { useMigratedDatabase } from "../helpers/test-database";
import { createUser } from "../helpers/factories";
import { createWorkspaceRightsHarness } from "../helpers/workspace-rights";

import type { WorkspaceRightsHarness } from "../helpers/workspace-rights";

function context(userId: string): RouterContextProvider {
  const provider = new RouterContextProvider();
  provider.set(authenticatedUserContext, createUser({ id: userId }));
  return provider;
}

function post(
  userId: string,
  fields: Record<string, string>,
): Parameters<typeof action>[0] {
  return {
    request: new Request("https://pages.invalid/agents/workspaces", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    context: context(userId),
    params: {},
    url: new URL("https://pages.invalid/agents/workspaces"),
    pattern: "/agents/workspaces",
  };
}

async function envelope(
  response: Response,
): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

describe("PAGE-25 workspace routes with the real service", () => {
  const getDatabase = useMigratedDatabase();
  let harness: WorkspaceRightsHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup(): Promise<WorkspaceRightsHarness> {
    harness = await createWorkspaceRightsHarness(getDatabase());
    services.current = { agentWorkspaceService: harness.workspaces };
    return harness;
  }

  it("answers a direct call for an inaccessible workspace exactly like one for a missing workspace", async () => {
    const current = await setup();
    const hidden = await current.register({ projectId: "engineering-project" });
    const designer = await current.person("designer", {
      isDepartmentBound: true,
      departments: ["design"],
    });
    const missing = "00000000-0000-4000-8000-000000000000";
    const attempts: readonly Record<string, string>[] = [
      { intent: "workspace-usages" },
      { intent: "delete-workspace", revision: "1" },
      {
        intent: "save-workspace",
        workspace: JSON.stringify({
          name: "Probe",
          path: "/anywhere",
          projectId: "project",
          revision: 1,
        }),
      },
    ];
    for (const fields of attempts) {
      const forHidden = await envelope(
        await action(post(designer, { ...fields, workspaceId: hidden })),
      );
      const forMissing = await envelope(
        await action(post(designer, { ...fields, workspaceId: missing })),
      );
      expect(forHidden.status).toBe(404);
      expect(forHidden.body).toMatchObject({
        ok: false,
        error: "workspace_not_found",
      });
      expect(forHidden).toEqual(forMissing);
    }
    expect(await current.repository.list()).toHaveLength(1);
    const page = await loader({
      request: new Request("https://pages.invalid/agents/workspaces"),
      context: context(designer),
      params: {},
      url: new URL("https://pages.invalid/agents/workspaces"),
      pattern: "/agents/workspaces",
    });
    expect(page.data.workspaces).toEqual([]);
    expect(JSON.stringify(page.data)).not.toContain("engineering-project");
  });

  it("keeps the selection endpoint to workspaces of accessible projects", async () => {
    const current = await setup();
    await current.register({ projectId: "engineering-project" });
    const open = await current.register({ projectId: "project" });
    const designer = await current.person("designer", {
      isDepartmentBound: true,
      departments: ["design"],
    });
    function request(query: string): Parameters<typeof choicesLoader>[0] {
      return {
        request: new Request(
          `https://pages.invalid/agent-api/workspaces${query}`,
        ),
        context: context(designer),
        params: {},
        url: new URL(`https://pages.invalid/agent-api/workspaces${query}`),
        pattern: "/agent-api/workspaces",
      };
    }
    const all = await choicesLoader(request(""));
    expect(all.status).toBe(200);
    const body = (await all.json()) as {
      workspaces: readonly { id: string; projectId: string }[];
    };
    expect(body.workspaces.map((entry) => entry.id)).toEqual([open]);
    const forbidden = await choicesLoader(
      request("?projectId=engineering-project"),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      ok: false,
      error: "workspace_access_denied",
    });
  });

  it("lets a project manager save and remove, refuses a plain member and an unlinked project", async () => {
    const current = await setup();
    const lead = await current.person("lead", {
      projectRoles: { project: "manager", unlinked: "manager" },
    });
    const member = await current.person("member", {
      projectRoles: { project: "member" },
    });
    const directory = await current.directory("managed");
    const proposed = JSON.stringify({
      name: "Managed",
      path: directory,
      projectId: "project",
      // Usage grants of older clients are ignored.
      targets: [{ kind: "person", targetId: member }],
    });
    const denied = await action(
      post(member, { intent: "save-workspace", workspace: proposed }),
    );
    expect(await envelope(denied)).toMatchObject({
      status: 403,
      body: { ok: false, error: "workspace_management_denied" },
    });
    expect(await current.repository.list()).toEqual([]);

    const saved = await action(
      post(lead, { intent: "save-workspace", workspace: proposed }),
    );
    expect(saved.status).toBe(200);
    const [registered] = await current.repository.list();
    expect(registered).toMatchObject({ name: "Managed", path: directory });

    const unsupported = await action(
      post(lead, {
        intent: "save-workspace",
        workspace: JSON.stringify({
          name: "Unlinked",
          path: await current.directory("unlinked"),
          projectId: "unlinked",
        }),
      }),
    );
    expect(await envelope(unsupported)).toMatchObject({
      status: 400,
      body: { ok: false, error: "workspace_project_unsupported" },
    });

    const refused = await action(
      post(member, {
        intent: "delete-workspace",
        workspaceId: registered.id,
        revision: "1",
      }),
    );
    expect(refused.status).toBe(403);
    expect(await current.repository.list()).toHaveLength(1);
    const removed = await action(
      post(lead, {
        intent: "delete-workspace",
        workspaceId: registered.id,
        revision: "1",
      }),
    );
    expect(removed.status).toBe(200);
    expect(await current.repository.list()).toEqual([]);
  });
});
