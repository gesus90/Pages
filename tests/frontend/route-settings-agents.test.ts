import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn(), setMode: vi.fn() },
  agentConnectionService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  agentCatalogService: { list: vi.fn(), configure: vi.fn(), run: vi.fn() },
  agentCheckService: { run: vi.fn() },
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
import {
  action as loginAction,
  loader as loginLoader,
} from "@/app/routes/settings-agents-login";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";

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
  });

  it("loads only safe metadata and performs no checks or login", async () => {
    const result = await loader(routeArgs({}, "GET"));
    expect(result.data).toEqual({
      access: "granted",
      connections: [createAgentConnection()],
      cliTools: CLI_LOCATIONS,
      catalogs: {},
    });
    expect(result.init?.headers).toEqual({ "Cache-Control": "no-store" });
    expect(services.agentCheckService.run).not.toHaveBeenCalled();
    expect(services.agentCliLoginService.start).not.toHaveBeenCalled();
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
          name: "Example",
          provider: "openai",
          apiKey: "synthetic-key-marker",
          testModel: "example",
          reasoningEffort: "high",
          code: "synthetic-input-marker",
          kind: "auth",
          intervalHours: "24",
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
