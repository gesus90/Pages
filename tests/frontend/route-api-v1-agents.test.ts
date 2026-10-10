import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import type { ApplicationServices } from "@/app/lib/services.server";

const verify = vi.fn();
const handle = vi.fn();
beforeEach(() => {
  verify.mockRejectedValue(new McpAuthorizationError("invalid_token", 401));
  vi.mocked(getApplicationServices).mockResolvedValue({
    pagesAgentApiService: { verify, handle },
  } as unknown as ApplicationServices);
});

import { action, loader } from "@/app/routes/api-v1-agents";

function args(request: Request): Parameters<typeof action>[0] {
  return {
    request,
    context: new RouterContextProvider(),
    params: {},
    url: new URL(request.url),
    pattern: "/api/v1/agents",
  };
}

describe("version 1 agent API foundation", () => {
  it("returns verified identity with its tool catalog and never trusts caller identity", async () => {
    verify.mockResolvedValue({
      userId: "owner",
      isAdmin: false,
      permissions: [],
    });
    handle.mockResolvedValue({
      apiVersion: "1",
      identity: { userId: "owner", isAdmin: false, permissions: [] },
      tools: ["projects.names.list"],
    });
    const input = {
      operation: "verify",
      parameters: {},
      actor: { isAdmin: true },
    };
    const response = await action(
      args(
        new Request("https://pages.invalid/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      identity: { isAdmin: false },
      tools: ["projects.names.list"],
    });
    expect(handle).toHaveBeenCalledWith("isolated-token", input);
  });

  it("fails closed on unavailable verification, invalid input and forbidden business calls", async () => {
    for (const [error, status, code] of [
      [new Error("sentinel-secret"), 503, "AUTH_UNAVAILABLE"],
      [new McpAuthorizationError("invalid_request"), 400, "INVALID_REQUEST"],
      [new McpAuthorizationError("FORBIDDEN", 403), 403, "FORBIDDEN"],
    ] as const) {
      verify.mockRejectedValue(error);
      const response = await action(
        args(
          new Request("https://pages.invalid/api/v1/agents", {
            method: "POST",
            headers: { Authorization: "Bearer isolated-token" },
          }),
        ),
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toContain(code);
    }
  });
  it.each([
    undefined,
    "Basic private",
    "Bearer",
    "Bearer ",
    "Bearer a b",
    "Bearer a,b",
  ])(
    "rejects missing or malformed authorization (%s) without reading input",
    async (authorization) => {
      const headers = new Headers({ Cookie: "pages_session=admin" });
      if (authorization !== undefined)
        headers.set("Authorization", authorization);
      const request = new Request("https://pages.invalid/api/v1/agents", {
        method: "POST",
        headers,
        body: "not even JSON",
      });
      const response = await action(args(request));
      expect(request.bodyUsed).toBe(false);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "AUTH_REQUIRED",
          message: "The agent API request was rejected.",
          retryable: false,
        },
      });
    },
  );

  it.each(["verify", "projects.names.list", "arbitrary"])(
    "never authenticates a supplied token or dispatches %s",
    async (operation) => {
      const request = new Request("https://pages.invalid/api/v1/agents", {
        method: "POST",
        headers: {
          Authorization: "bEaReR sentinel-secret",
          Cookie: "pages_session=admin",
        },
        body: JSON.stringify({
          operation,
          parameters: {},
          actor: { isAdmin: true },
        }),
      });
      const response = await action(args(request));
      expect(request.bodyUsed).toBe(false);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "AUTH_INVALID",
          message: "The agent API request was rejected.",
          retryable: false,
        },
      });
    },
  );

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "rejects %s with a stable method error",
    async (method) => {
      const input = args(
        new Request("https://pages.invalid/api/v1/agents", { method }),
      );
      const response = await (method === "GET" ? loader(input) : action(input));
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "The agent API request was rejected.",
          retryable: false,
        },
      });
    },
  );
});

describe("A9.5 route failures", () => {
  it.each([
    "INVALID_REQUEST",
    "NOT_FOUND",
    "AMBIGUOUS",
    "PAYLOAD_TOO_LARGE",
  ] as const)("maps %s to the stable business status", async (code) => {
    verify.mockResolvedValue({ userId: "reader" });
    const details =
      code === "AMBIGUOUS"
        ? { candidates: [{ id: "a", name: "Alpha" }], truncated: false }
        : undefined;
    const error = new AgentOperationError(code, details);
    handle.mockRejectedValue(error);
    const response = await action(
      args(
        new Request("http://127.0.0.1/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ operation: "wiki.tree.read", parameters: {} }),
        }),
      ),
    );
    expect(response.status).toBe(error.status);
    expect(await response.json()).toEqual({
      apiVersion: "1",
      error: {
        code,
        message: "The agent API request was rejected.",
        retryable: false,
        ...(details === undefined ? {} : { details }),
      },
    });
  });

  it("rejects an oversized authenticated body before parsing or dispatch", async () => {
    verify.mockResolvedValue({ userId: "reader" });
    const parse = vi.spyOn(JSON, "parse");
    const response = await action(
      args(
        new Request("http://127.0.0.1/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: "ä".repeat(32769),
        }),
      ),
    );
    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(await response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
