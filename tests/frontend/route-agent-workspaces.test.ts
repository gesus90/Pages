import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const workspaceService = vi.hoisted(() => ({
  page: vi.fn(),
  choices: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  usages: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    agentWorkspaceService: workspaceService,
  }),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, headers, loader } from "@/app/routes/agent-workspaces";
import { loader as choicesLoader } from "@/app/routes/agent-workspace-choices";
import { AgentError } from "@/backend/error/AgentErrors";

import { createUser } from "../helpers/factories";

function args(
  fields: Record<string, string> = {},
  method = "POST",
  isAuthenticated = true,
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, isAuthenticated ? createUser() : null);
  return {
    request: new Request("https://pages.invalid/agents/workspaces", {
      method,
      body: method === "POST" ? new URLSearchParams(fields) : undefined,
    }),
    context,
    params: {},
    url: new URL("https://pages.invalid/agents/workspaces"),
    pattern: "/agents/workspaces",
  };
}

describe("A10.3 workspace route boundaries", () => {
  it("loads authorized metadata, bounds every envelope and rejects missing intent", async () => {
    workspaceService.page.mockResolvedValue({ workspaces: [] });
    const page = await loader(args({}, "GET"));
    expect(page.data).toEqual({ workspaces: [] });
    expect(workspaceService.page).toHaveBeenCalledWith(createUser().id);
    expect((await action(args())).status).toBe(400);
    expect((await action(args({ intent: "save-workspace" }))).status).toBe(500);
    expect(
      (
        await action(
          args({ intent: "save-workspace", workspace: "x".repeat(50001) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await action(
          args({ intent: "workspace-usages", workspaceId: "x".repeat(101) }),
        )
      ).status,
    ).toBe(400);
    for (const revision of ["", "1.5", "Infinity"])
      expect(
        (await action(args({ intent: "delete-workspace", revision }))).status,
      ).toBe(400);
    expect(
      (
        await choicesLoader({
          ...args({}, "GET"),
          request: new Request(
            "https://pages.invalid/agent-api/workspaces?projectId=" +
              "x".repeat(101),
          ),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await choicesLoader({
          ...args({}, "GET"),
          request: new Request(
            "https://pages.invalid/agent-api/workspaces?projectId=project",
          ),
        })
      ).status,
    ).toBe(200);
  });

  it("keeps selection responses uncacheable and refuses unauthenticated or invalid project queries", async () => {
    workspaceService.choices.mockResolvedValue([{ id: "allowed" }]);
    const current = args({}, "GET");
    const response = await choicesLoader(current);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ workspaces: [{ id: "allowed" }] });
    expect((await choicesLoader(args({}, "GET", false))).status).toBe(403);
    expect(
      (
        await choicesLoader({
          ...current,
          request: new Request(
            "https://pages.invalid/agent-api/workspaces?projectId=",
          ),
        })
      ).status,
    ).toBe(400);
    workspaceService.choices.mockRejectedValueOnce(
      new AgentError("workspace_access_denied"),
    );
    expect((await choicesLoader(current)).status).toBe(403);
    await expect(loader(args({}, "GET", false))).rejects.toMatchObject({
      status: 403,
    });
    const combined = new Headers(
      headers({
        parentHeaders: new Headers({ "X-Frame-Options": "DENY" }),
        loaderHeaders: new Headers(),
        actionHeaders: new Headers(),
        errorHeaders: undefined,
      }),
    );
    expect(combined.get("Cache-Control")).toBe("no-store");
    expect(combined.get("X-Frame-Options")).toBe("DENY");
  });

  it("uses the signed-in user for metadata actions and sanitizes native and authorization errors", async () => {
    workspaceService.save.mockResolvedValue("new");
    const proposed = {
      name: "Existing",
      path: "/approved/work",
      projectId: "project",
    };
    const request = args({
      intent: "save-workspace",
      workspace: JSON.stringify(proposed),
      userId: "forged",
    });
    const response = await action(request);
    expect(response.status).toBe(200);
    expect(workspaceService.save).toHaveBeenCalledWith(
      createUser().id,
      null,
      proposed,
    );
    workspaceService.save.mockRejectedValueOnce(
      new AgentError("workspace_access_denied"),
    );
    expect(
      (await action(args({ intent: "save-workspace", workspace: "{}" })))
        .status,
    ).toBe(403);
    workspaceService.save.mockRejectedValueOnce(
      new Error("sensitive native path"),
    );
    const failed = await action(
      args({ intent: "save-workspace", workspace: "{}" }),
    );
    expect(await failed.text()).not.toContain("sensitive native path");
    workspaceService.usages.mockResolvedValue([
      { id: "agent", name: "Worker", kind: "agent" },
    ]);
    expect(
      await (
        await action(
          args({ intent: "workspace-usages", workspaceId: "workspace" }),
        )
      ).json(),
    ).toEqual({
      ok: true,
      intent: "workspace-usages",
      workspaceUsages: [{ id: "agent", name: "Worker", kind: "agent" }],
    });
    await action(
      args({
        intent: "delete-workspace",
        workspaceId: "workspace",
        revision: "3",
      }),
    );
    expect(workspaceService.remove).toHaveBeenCalledWith(
      createUser().id,
      "workspace",
      3,
    );
    expect(
      (
        await action(
          args({
            intent: "delete-workspace",
            workspaceId: "workspace",
            revision: "-1",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await action(args({ intent: "unknown" }))).status).toBe(400);
    expect((await action(args({}, "GET"))).status).toBe(405);
    expect((await action(args({}, "POST", false))).status).toBe(403);
  });
});
