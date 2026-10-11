import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn(), setMode: vi.fn() },
  agentWorkspaceService: { choices: vi.fn().mockResolvedValue([]) },
  agentProfileService: {
    list: vi.fn().mockResolvedValue([]),
    filteredList: vi.fn().mockResolvedValue({ profiles: [], availability: {} }),
    projects: vi.fn().mockResolvedValue([]),
    usages: vi.fn().mockResolvedValue([]),
    catalog: vi.fn().mockResolvedValue([]),
    directory: vi
      .fn()
      .mockResolvedValue({ persons: [], groups: [], departments: [] }),
    save: vi.fn(),
    remove: vi.fn(),
  },
  agentConnectionService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
  },
  agentCatalogService: { list: vi.fn(), configure: vi.fn(), run: vi.fn() },
  agentCheckService: { run: vi.fn() },
  textAgentRoleService: {
    read: vi.fn(),
    save: vi.fn(),
    saveRetention: vi.fn(),
  },
  agentAssignmentService: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
  agentCliLoginService: {
    tools: vi.fn(),
    read: vi.fn(),
    start: vi.fn(),
    submitCode: vi.fn(),
    cancel: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { action, headers, loader } from "@/app/routes/settings-agents";
import { loader as definitionsLoader } from "@/app/routes/agent-definitions";
import {
  action as loginAction,
  loader as loginLoader,
} from "@/app/routes/settings-agents-login";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { createAccess } from "../helpers/authorization";
import { CLI_LOCATIONS, createAgentConnection } from "../helpers/agents";
import { createUser } from "../helpers/factories";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";

function routeArgs(
  fields: Record<string, string> = {},
  method = "POST",
  isAuthenticated = true,
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, isAuthenticated ? createUser() : null);
  return {
    request: new Request("https://pages.invalid/settings/agents", {
      method,
      body: method === "POST" ? new URLSearchParams(fields) : undefined,
    }),
    context,
    params: {},
    url: new URL("https://pages.invalid/settings/agents"),
    pattern: "/settings/agents",
  };
}

function pollArgs(
  method = "GET",
  isAuthenticated = true,
): Parameters<typeof loginLoader>[0] {
  return {
    ...routeArgs({}, method, isAuthenticated),
    params: { connectionId: "id" },
  };
}

const INTENTS = [
  "save-profile",
  "delete-profile",
  "profile-usages",
  "set-connection-active",
  "create-assignment",
  "update-assignment",
  "delete-assignment",
  "configure-retention",
  "configure-text",
  "create-connection",
  "update-connection",
  "delete-connection",
  "run-check",
  "configure-catalog",
  "refresh-catalog",
  "start-login",
  "submit-login-code",
  "cancel-login",
  "logout-cli",
];

describe("agent routes", () => {
  beforeEach(() => {
    services.administrationService.getContext.mockResolvedValue(
      createAccess({ isAdmin: true, mode: "admin" }),
    );
    services.agentConnectionService.list.mockResolvedValue([
      createAgentConnection(),
    ]);
    services.agentCliLoginService.tools.mockResolvedValue(CLI_LOCATIONS);
    services.agentCatalogService.list.mockResolvedValue({});
    services.agentAssignmentService.list.mockResolvedValue([]);
    services.agentProfileService.list.mockResolvedValue([]);
    services.agentProfileService.filteredList.mockResolvedValue({
      profiles: [],
      availability: {},
    });
    services.agentProfileService.projects.mockResolvedValue([]);
    services.agentProfileService.catalog.mockResolvedValue([]);
    services.agentProfileService.directory.mockResolvedValue({
      persons: [],
      groups: [],
      departments: [],
    });
    services.textAgentRoleService.read.mockResolvedValue({
      role: null,
      retentionDays: 30,
    });
  });

  it("loads only safe metadata and performs no checks or login", async () => {
    const result = await loader(routeArgs({}, "GET"));
    expect(result.data).toEqual({
      access: "granted",
      connections: [createAgentConnection()],
      cliTools: CLI_LOCATIONS,
      catalogs: {},
      assistantSettings: { role: null, retentionDays: 30 },
      assignments: [],
      profiles: [],
      availability: {},
      projects: [],
      filters: {
        search: "",
        scope: "",
        provider: "",
        connection: "",
        purpose: "",
        status: "",
        usability: "",
      },
      profileDirectory: { persons: [], groups: [], departments: [] },
    });
    expect(result.init?.headers).toEqual({ "Cache-Control": "no-store" });
    expect(services.agentCheckService.run).not.toHaveBeenCalled();
    expect(services.agentCliLoginService.start).not.toHaveBeenCalled();
  });

  it("reads only the current user's catalog in a validated project context without provider requests", async () => {
    const args = routeArgs({}, "GET");
    const response = await definitionsLoader({
      ...args,
      request: new Request(
        "https://pages.invalid/agent-api/definitions?projectId=project",
      ),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ agents: [] });
    expect(services.agentProfileService.catalog).toHaveBeenCalledWith(
      createUser().id,
      "project",
    );
    expect(services.agentCheckService.run).not.toHaveBeenCalled();
    const denied = await definitionsLoader(routeArgs({}, "GET", false));
    expect(denied.status).toBe(403);
    const malformed = await definitionsLoader({
      ...args,
      request: new Request(
        "https://pages.invalid/agent-api/definitions?projectId=",
      ),
    });
    expect(malformed.status).toBe(400);
  });

  it("loads deletion references through the protected action and returns safe conflict errors", async () => {
    services.agentProfileService.usages.mockResolvedValueOnce([
      { kind: "global" },
    ]);
    const response = await action(
      routeArgs({ intent: "profile-usages", profileId: "selected" }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      intent: "profile-usages",
      usages: [{ kind: "global" }],
    });
    expect(services.agentProfileService.usages).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "admin" }),
      "selected",
    );
    services.agentProfileService.remove.mockRejectedValueOnce(
      new AgentError("profile_in_use"),
    );
    expect(
      (
        await action(
          routeArgs({ intent: "delete-profile", profileId: "selected" }),
        )
      ).status,
    ).toBe(409);
    services.agentProfileService.save.mockRejectedValueOnce(
      new AgentError("profile_conflict"),
    );
    expect(
      (
        await action(
          routeArgs({
            intent: "save-profile",
            profileId: "selected",
            profile: "{}",
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("assigns and clears Text independently of diagnostic defaults and maps invalid assignments", async () => {
    await action(
      routeArgs({
        intent: "configure-text",
        connectionId: "id",
        model: "catalog-model",
        reasoningEffort: "medium",
        retentionDays: "30",
      }),
    );
    expect(services.textAgentRoleService.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "admin" }),
      {
        role: {
          connectionId: "id",
          model: "catalog-model",
          reasoningEffort: "medium",
        },
        retentionDays: 30,
      },
    );
    await action(routeArgs({ intent: "configure-text", retentionDays: "1" }));
    expect(services.textAgentRoleService.save).toHaveBeenLastCalledWith(
      expect.anything(),
      { role: null, retentionDays: 1 },
    );
    services.textAgentRoleService.save.mockRejectedValueOnce(
      new TextAssistantError("modelUnavailable"),
    );
    expect(
      await (await action(routeArgs({ intent: "configure-text" }))).json(),
    ).toEqual({ ok: false, intent: "", error: "modelUnavailable" });
  });

  it("validates predefined functions, persists exact assignments and changes retention independently", async () => {
    for (const intent of ["create-assignment", "update-assignment"]) {
      await action(
        routeArgs({
          intent,
          function: "skills",
          connectionId: "acc2",
          model: "listed",
          reasoningEffort: "medium",
        }),
      );
      expect(services.agentAssignmentService.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: "admin" }),
        {
          function: "skills",
          connectionId: "acc2",
          model: "listed",
          reasoningEffort: "medium",
        },
        intent === "create-assignment" ? "create" : "update",
      );
    }
    await action(
      routeArgs({
        intent: "create-assignment",
        function: "text",
        connectionId: "acc1",
        model: "plain",
      }),
    );
    expect(services.agentAssignmentService.save).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        function: "text",
        connectionId: "acc1",
        model: "plain",
        reasoningEffort: null,
      },
      "create",
    );
    const invalid = await action(
      routeArgs({
        intent: "create-assignment",
        function: "execute-shell",
        connectionId: "acc1",
      }),
    );
    expect(await invalid.json()).toMatchObject({
      ok: false,
      error: "function_invalid",
    });
    await action(
      routeArgs({ intent: "delete-assignment", function: "skills" }),
    );
    expect(services.agentAssignmentService.remove).toHaveBeenLastCalledWith(
      expect.anything(),
      "skills",
    );
    await action(
      routeArgs({ intent: "configure-retention", retentionDays: "7" }),
    );
    expect(
      services.textAgentRoleService.saveRetention,
    ).toHaveBeenLastCalledWith(expect.anything(), 7);
    expect(services.textAgentRoleService.save).not.toHaveBeenCalled();
  });

  it("sends page, data and action answers as no-store with the parent security headers", () => {
    const sent = new Headers(
      headers({
        parentHeaders: new Headers({
          "Cache-Control": "public, max-age=60",
          "X-Frame-Options": "DENY",
        }),
        loaderHeaders: new Headers(),
        actionHeaders: new Headers(),
        errorHeaders: undefined,
      }),
    );
    expect(sent.get("Cache-Control")).toBe("no-store");
    expect(sent.get("X-Frame-Options")).toBe("DENY");
  });

  it("returns only the mode switch to an administrator in role mode", async () => {
    services.administrationService.getContext.mockResolvedValue(
      createAccess({ isAdmin: true, mode: "role" }),
    );
    expect((await loader(routeArgs({}, "GET"))).data).toEqual({
      access: "adminModeRequired",
    });
    expect(services.agentConnectionService.list).not.toHaveBeenCalled();
    expect(services.agentCliLoginService.tools).not.toHaveBeenCalled();
    expect(services.agentCatalogService.list).not.toHaveBeenCalled();
    const response = await action(
      routeArgs({ intent: "set-mode", mode: "admin" }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ intent: "set-mode", ok: true });
  });

  it.each([
    createAccess(),
    createAccess({ isAdmin: true, isActive: false }),
    createAccess({ isAdmin: false, mode: "admin" }),
  ])("rejects inactive or nonadministrator accounts", async (account) => {
    services.administrationService.getContext.mockResolvedValue(account);
    await expect(loader(routeArgs({}, "GET"))).rejects.toMatchObject({
      status: 403,
    });
    expect((await loginLoader(pollArgs())).status).toBe(403);
    for (const intent of INTENTS)
      expect(
        (await action(routeArgs({ intent, connectionId: "id" }))).status,
      ).toBe(403);
    expect(services.agentConnectionService.create).not.toHaveBeenCalled();
    expect(services.agentCheckService.run).not.toHaveBeenCalled();
    expect(services.agentCatalogService.run).not.toHaveBeenCalled();
    expect(services.agentCatalogService.configure).not.toHaveBeenCalled();
  });

  it("checks fresh mode and authentication on every action and poll", async () => {
    services.administrationService.getContext.mockResolvedValue(
      createAccess({ isAdmin: true, mode: "role" }),
    );
    for (const intent of INTENTS)
      expect(
        (await action(routeArgs({ intent, connectionId: "id" }))).status,
      ).toBe(403);
    expect((await loginLoader(pollArgs())).status).toBe(403);
    expect(
      (await action(routeArgs({ intent: "create-connection" }, "POST", false)))
        .status,
    ).toBe(403);
    expect((await loginLoader(pollArgs("GET", false))).status).toBe(403);
    await expect(loader(routeArgs({}, "GET", false))).rejects.toMatchObject({
      status: 403,
    });
    expect(services.agentCliLoginService.read).not.toHaveBeenCalled();
  });

  it("dispatches every explicit intent and never echoes keys or entered codes", async () => {
    services.agentConnectionService.create.mockResolvedValue("id");
    services.agentCheckService.run.mockResolvedValue({
      status: "passed",
      errorCode: null,
      detail: {},
      durationMs: 1,
      checkedAt: "now",
    });
    services.agentCliLoginService.start.mockResolvedValue({
      state: "starting",
    });
    for (const intent of INTENTS) {
      const response = await action(
        routeArgs({
          intent,
          connectionId: "id",
          isActive: "true",
          profile: JSON.stringify({ name: "Profile", isActive: true }),
          name: "Example",
          provider: "openai",
          apiKey: "synthetic-key-marker",
          testModel: "example",
          reasoningEffort: "high",
          code: "synthetic-input-marker",
          kind: "auth",
          intervalHours: "24",
          function: "text",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain("synthetic-key-marker");
      expect(text).not.toContain("synthetic-input-marker");
      expect(text).toContain('"ok":true');
    }
    expect(services.agentConnectionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "admin" }),
      {
        name: "Example",
        provider: "openai",
        apiKey: "synthetic-key-marker",
        testModel: "example",
        reasoningEffort: "high",
      },
    );
    expect(services.agentConnectionService.update).toHaveBeenCalledWith(
      expect.anything(),
      "id",
      expect.objectContaining({
        testModel: "example",
        reasoningEffort: "high",
      }),
    );
    expect(services.agentConnectionService.update).toHaveBeenCalledTimes(1);
    expect(services.agentConnectionService.remove).toHaveBeenCalledTimes(1);
    expect(services.agentCliLoginService.submitCode).toHaveBeenCalledWith(
      expect.anything(),
      "id",
      "synthetic-input-marker",
    );
    expect(services.agentCliLoginService.cancel).toHaveBeenCalledTimes(1);
    expect(services.agentCliLoginService.logout).toHaveBeenCalledTimes(1);
    await action(
      routeArgs({ intent: "run-check", connectionId: "id", kind: "model" }),
    );
    expect(services.agentCheckService.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "id",
      "model",
    );
    await action(routeArgs({ intent: "create-connection" }));
    expect(services.agentConnectionService.create).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        name: "",
        provider: undefined,
        apiKey: "",
        testModel: "",
        reasoningEffort: "",
      },
    );
  });

  it("dispatches cadence changes and metadata-only refreshes, rejecting absent timing input", async () => {
    await action(
      routeArgs({
        intent: "configure-catalog",
        connectionId: "id",
        intervalHours: "0",
      }),
    );
    expect(services.agentCatalogService.configure).toHaveBeenLastCalledWith(
      expect.anything(),
      "id",
      0,
    );
    await action(
      routeArgs({ intent: "configure-catalog", connectionId: "id" }),
    );
    expect(services.agentCatalogService.configure).toHaveBeenLastCalledWith(
      expect.anything(),
      "id",
      NaN,
    );
    await action(routeArgs({ intent: "refresh-catalog", connectionId: "id" }));
    expect(services.agentCatalogService.run).toHaveBeenCalledWith(
      expect.anything(),
      "id",
    );
    expect(services.agentCheckService.run).not.toHaveBeenCalled();
  });

  it("validates activation and profile envelopes and dispatches deliberate profile replacement", async () => {
    for (const isActive of ["true", "false"]) {
      expect(
        (
          await action(
            routeArgs({
              intent: "set-connection-active",
              connectionId: "id",
              isActive,
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        services.agentConnectionService.setActive,
      ).toHaveBeenLastCalledWith(expect.anything(), "id", isActive === "true");
    }
    expect(
      (
        await action(
          routeArgs({
            intent: "set-connection-active",
            connectionId: "id",
            isActive: "yes",
          }),
        )
      ).status,
    ).toBe(400);
    for (const profile of [
      "invalid JSON",
      "x".repeat(50001),
      "x".repeat(500001),
    ])
      expect(
        (await action(routeArgs({ intent: "save-profile", profile }))).status,
      ).toBeGreaterThanOrEqual(400);
    const profile = {
      name: "Named",
      connectionId: "id",
      model: "model",
      reasoningEffort: null,
      isActive: true,
      purposes: ["text"],
      targets: [{ kind: "person", targetId: "person" }],
    };
    await action(
      routeArgs({ intent: "save-profile", profile: JSON.stringify(profile) }),
    );
    expect(services.agentProfileService.save).toHaveBeenLastCalledWith(
      expect.anything(),
      null,
      profile,
    );
    await action(
      routeArgs({
        intent: "save-profile",
        profileId: "selected",
        profile: JSON.stringify(profile),
      }),
    );
    expect(services.agentProfileService.save).toHaveBeenLastCalledWith(
      expect.anything(),
      "selected",
      profile,
    );
    await action(
      routeArgs({ intent: "delete-profile", profileId: "selected" }),
    );
    expect(services.agentProfileService.remove).toHaveBeenLastCalledWith(
      expect.anything(),
      "selected",
    );
  });

  it("validates request method, intent, identifier and check kind", async () => {
    const invalidFields: ReadonlyArray<Record<string, string>> = [
      {},
      { intent: "__proto__" },
      { intent: "unknown" },
      { intent: "run-check", connectionId: "id", kind: "invalid" },
    ];
    for (const fields of invalidFields)
      expect((await action(routeArgs(fields))).status).toBe(400);
    expect(
      (await action(routeArgs({ intent: "update-connection" }))).status,
    ).toBe(404);
    const method = await action(routeArgs({}, "GET"));
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("POST");
    expect(method.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns pending challenges only from the protected no-store GET resource", async () => {
    services.agentCliLoginService.read.mockResolvedValue({
      state: "awaiting_user",
      userCode: "SYNTHETIC",
      verificationUrl: "https://auth.openai.com/codex/device",
    });
    const response = await loginLoader(pollArgs());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ userCode: "SYNTHETIC" });
    services.agentCliLoginService.read.mockResolvedValue(null);
    expect(await (await loginLoader(pollArgs())).json()).toBeNull();
    for (const response of [
      loginAction(),
      await loginLoader(pollArgs("HEAD")),
    ]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("maps expected errors and scrubs unexpected exceptions", async () => {
    const statuses: Partial<Record<AgentErrorCode, number>> = {
      name_taken: 400,
      connection_not_found: 404,
      check_in_progress: 409,
      login_in_progress: 409,
      login_limit_reached: 409,
      login_not_running: 409,
      credential_cleanup_failed: 500,
      profile_in_use: 409,
      profile_conflict: 409,
      agent_usage_denied: 403,
    };
    for (const [code, status] of Object.entries(statuses)) {
      if (!isAgentErrorCode(code)) throw new Error("Invalid test fixture");
      const error = new AgentError(code);
      expect(agentFailureResponse(error, "update-connection").status).toBe(
        status,
      );
    }
    services.agentConnectionService.create.mockRejectedValue(
      new Error("synthetic-secret-error"),
    );
    const response = await action(
      routeArgs({
        intent: "create-connection",
        apiKey: "synthetic-secret-error",
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      intent: "",
      error: "general",
    });
    const preserved = agentFailureResponse(
      new Response("Forbidden", {
        status: 403,
        headers: { "X-Example": "yes" },
      }),
    );
    expect(preserved.headers.get("X-Example")).toBe("yes");
    expect(preserved.headers.get("Cache-Control")).toBe("no-store");
  });
});
