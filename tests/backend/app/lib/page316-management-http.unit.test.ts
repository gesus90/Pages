import { beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

import { runManagementRoute } from "@/app/lib/management-route.server";
import { managementRequestMiddleware } from "@/app/lib/management-middleware.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import { accountFixture } from "../../backend/auth/account-fixture";

const boundaries = vi.hoisted(() => ({
  authenticate: vi.fn(),
  call: vi.fn(),
  account: vi.fn(),
  audit: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    mcpUserApi: { authenticate: boundaries.authenticate },
    mcpDeviceService: { authenticate: boundaries.authenticate },
    administrationService: { getContext: boundaries.account },
    managementService: {
      call: boundaries.call,
      audit: { run: boundaries.audit },
    },
  }),
}));
vi.mock("@/app/lib/session.server", () => ({
  getSessionToken: async () => "fixture-session",
}));
vi.mock("@/app/lib/auth.server", () => ({
  getAuthenticatedUser: boundaries.getUser,
}));
vi.mock("@/app/lib/setup-gate.server", () => ({
  isSetupPending: async () => false,
}));

beforeEach(() => {
  boundaries.authenticate.mockResolvedValue({
    id: "management",
    account: { id: "management" },
  });
  boundaries.getUser.mockResolvedValue({ id: "management" });
  boundaries.account.mockResolvedValue(
    accountFixture({ userId: "management", roleId: ADMINISTRATION_ROLE_ID }),
  );
  boundaries.audit.mockImplementation(
    async (actor, action, target, work: () => Promise<Response>) => work(),
  );
  boundaries.call.mockResolvedValue({ id: "target", revision: "new-revision" });
});

it("uses existing bearer authentication and forwards only parsed contract fields", async () => {
  const request = new Request(
    "http://pages.invalid/api/mcp/v1/users/target/status",
    {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({ expectedRevision: "old", status: "deactivated" }),
    },
  );
  const response = await runManagementRoute(request, "users_set_status", {
    userId: "target",
  });
  expect(boundaries.authenticate).toHaveBeenCalledWith("Bearer fixture");
  expect(boundaries.call).toHaveBeenCalledWith(
    "management",
    "users_set_status",
    { userId: "target", expectedRevision: "old", status: "deactivated" },
  );
  expect(await response.json()).toEqual({
    id: "target",
    revision: "new-revision",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("returns the public uppercase failure and reason without an internal exception message", async () => {
  boundaries.call.mockRejectedValue(
    new AgentOperationError("FORBIDDEN", { reason: "admin_target" }),
  );
  const response = await runManagementRoute(
    new Request("http://pages.invalid/api/mcp/v1/users/admin"),
    "users_read",
    { userId: "admin" },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "FORBIDDEN",
    reason: "admin_target",
  });
});

it("refuses oversized envelopes before JSON parsing", async () => {
  const request = new Request("http://pages.invalid/api/mcp/v1/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(8 * 1024 * 1024),
    },
    body: "{}",
  });
  const response = await runManagementRoute(request, "users_create");
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
});

it.each([
  "/settings/system",
  "/settings-api/agents",
  "/settings-api/runners",
  "/agents/workspaces/remote/connections/x/setup",
  "/api/mcp/v1/remote-connections",
  "/api/mcp/v1/storage",
  "/setup",
])(
  "refuses the core endpoint %s for management before dispatch",
  async (path) => {
    const request = new Request(`http://pages.invalid${path}`);
    const next = vi.fn(async () => new Response("core"));
    const response = await managementRequestMiddleware(
      {
        request,
        context: new RouterContextProvider(),
        params: {},
        url: new URL(request.url),
        pattern: path,
      },
      next,
    );
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected response");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "FORBIDDEN",
      reason: "core_system",
    });
    expect(next).not.toHaveBeenCalled();
    expect(boundaries.audit).toHaveBeenCalledWith(
      "management",
      "GET",
      path,
      expect.any(Function),
    );
  },
);

it("preserves active administrator mode for a personal administrator who holds Management", async () => {
  boundaries.account.mockResolvedValue(
    accountFixture({
      userId: "management",
      roleId: ADMINISTRATION_ROLE_ID,
      isAdmin: true,
      mode: "admin",
    }),
  );
  const request = new Request("http://pages.invalid/settings/system");
  const next = vi.fn(async () => new Response("allowed"));
  await managementRequestMiddleware(
    {
      request,
      context: new RouterContextProvider(),
      params: {},
      url: new URL(request.url),
      pattern: "/settings/system",
    },
    next,
  );
  expect(next).toHaveBeenCalledOnce();
});

it("explicitly rejects account deletion for Management", async () => {
  const { rejectManagementAccountDeletion } =
    await import("@/app/lib/management-route.server");
  const response = await rejectManagementAccountDeletion(
    new Request("http://pages.invalid/api/mcp/v1/users/target", {
      method: "DELETE",
      headers: { authorization: "Bearer fixture" },
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "FORBIDDEN",
    reason: "core_system",
  });
});

it("converts an audited management operation error to a no-store response", async () => {
  const request = new Request("http://pages.invalid/projects");
  const response = await managementRequestMiddleware(
    {
      request,
      context: new RouterContextProvider(),
      params: {},
      url: new URL(request.url),
      pattern: "/projects",
    },
    async () => {
      throw new AgentOperationError("CONFLICT", { reason: "revision" });
    },
  );
  expect(response).toBeInstanceOf(Response);
  if (!(response instanceof Response)) throw new Error("Expected response");
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: "CONFLICT",
    reason: "revision",
  });
});
