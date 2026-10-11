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
        message:
          code === "NOT_FOUND"
            ? "Not found or no access."
            : "The agent API request was rejected.",
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

describe("A9.7 import preview route", () => {
  it("forwards a stateless plan through the authenticated operation contract and returns a bounded result envelope", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    const result = {
      pages: [],
      edges: [],
      errors: [],
      conflicts: [],
      assets: [],
      fingerprint: "f".repeat(64),
    };
    handle.mockResolvedValue({ apiVersion: "1", result });
    const input = {
      operation: "wiki.import.plan",
      parameters: {
        projectId: "alpha",
        parentId: null,
        manifest: {
          version: "1",
          index: [{ sourceKey: "a.md", title: "A", titleSource: "h1" }],
          files: [{ sourceKey: "a.md", content: "# A" }],
        },
      },
    };
    const response = await action(
      args(
        new Request("http://127.0.0.1/api/v1/agents", {
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
    expect(handle).toHaveBeenCalledExactlyOnceWith("isolated-token", input);
    expect(await response.json()).toEqual({ apiVersion: "1", result });
  });

  it("preserves the concrete package limit in its safe 413 response", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    handle.mockRejectedValue(
      new AgentOperationError("PAYLOAD_TOO_LARGE", {
        constraint: "importFileBytes",
        limit: 16_384,
      }),
    );
    const response = await action(
      args(
        new Request("http://127.0.0.1/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operation: "wiki.import.plan",
            parameters: {},
          }),
        }),
      ),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint: "importFileBytes", limit: 16_384 },
      },
    });
  });
});

describe("A9.8 import application route", () => {
  it("forwards the operation key and returns identical committed IDs on repeated requests", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    const result = {
      runId: "run",
      status: "partial",
      counts: { created: 1, skipped: 0, conflict: 1, failed: 0 },
      items: [
        {
          sourceKey: "a.md",
          pageId: "page",
          assets: [{ assetId: "asset", attachmentId: "attachment" }],
        },
      ],
    };
    handle.mockResolvedValue({ apiVersion: "1", result });
    const input = {
      operation: "wiki.import.apply",
      parameters: {
        operationId: "retry-key",
        fingerprint: "a".repeat(64),
        projectId: "alpha",
        parentId: null,
        manifest: { version: "1", index: [], files: [] },
        assets: [],
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
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
      expect(await response.json()).toEqual({ apiVersion: "1", result });
    }
    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenLastCalledWith("isolated-token", input);
  });

  it("returns a stale import fingerprint as a safe conflict response", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    handle.mockRejectedValue(new AgentOperationError("CONFLICT"));
    const response = await action(
      args(
        new Request("https://pages.invalid/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operation: "wiki.import.apply",
            parameters: {},
          }),
        }),
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      apiVersion: "1",
      error: { code: "CONFLICT", retryable: false },
    });
  });
});

describe("A9.9 import update route", () => {
  it("returns per-source conflicts as a repeatable successful response and forwards explicit overwrite", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    const result = {
      status: "partial",
      counts: { updated: 1, skipped: 0, conflict: 1, failed: 0 },
      items: [
        {
          sourceKey: "a.md",
          action: "updated",
          reason: "overwritten",
          revision: 3,
        },
        {
          sourceKey: "b.md",
          action: "conflict",
          reason: "manual_change",
          errorCode: "CONFLICT",
          revision: 2,
        },
      ],
    };
    handle.mockResolvedValue({ apiVersion: "1", result });
    const input = {
      operation: "wiki.import.update",
      parameters: {
        operationId: "update-key",
        fingerprint: "a".repeat(64),
        projectId: "alpha",
        parentId: null,
        manifest: { version: "1", index: [], files: [] },
        updates: [
          { sourceKey: "a.md", expectedRevision: 2, overwrite: true },
          { sourceKey: "b.md", expectedRevision: 2 },
        ],
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
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
      expect(await response.json()).toEqual({ apiVersion: "1", result });
    }
    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenLastCalledWith("isolated-token", input);
  });

  it("returns a rejected update fingerprint as HTTP 409", async () => {
    verify.mockResolvedValue({ userId: "writer" });
    handle.mockRejectedValue(new AgentOperationError("CONFLICT"));
    const response = await action(
      args(
        new Request("https://pages.invalid/api/v1/agents", {
          method: "POST",
          headers: {
            Authorization: "Bearer isolated-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operation: "wiki.import.update",
            parameters: {},
          }),
        }),
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "CONFLICT", retryable: false },
    });
  });
});

describe("A9.10 granular wiki routes", () => {
  it.each([
    ["wiki.page.setTitle", { title: "Title" }],
    ["wiki.page.setContent", { content: "# Text\r\n" }],
    ["wiki.page.setIcon", { icon: null }],
    [
      "wiki.page.move",
      { projectId: "alpha", parentId: "/wiki/parent", beforeId: null },
    ],
  ])(
    "forwards %s with its revision and operation key and returns the replayed result",
    async (operation, fields) => {
      verify.mockResolvedValue({ userId: "writer" });
      const input = {
        operation,
        parameters: {
          operationId: "change",
          pageId: "/wiki/page",
          expectedRevision: 1,
          ...fields,
        },
      };
      const result = {
        pageId: "page",
        link: "/wiki/page",
        changed: true,
        revision: 2,
      };
      handle.mockResolvedValue({ apiVersion: "1", result });
      for (let attempt = 0; attempt < 2; attempt++) {
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
        expect(await response.json()).toEqual({ apiVersion: "1", result });
      }
      expect(handle).toHaveBeenCalledTimes(2);
      expect(handle).toHaveBeenLastCalledWith("isolated-token", input);
    },
  );

  it.each(["CONFLICT", "NOT_FOUND", "FORBIDDEN", "INVALID_REQUEST"] as const)(
    "returns the safe granular wiki error %s",
    async (code) => {
      verify.mockResolvedValue({ userId: "writer" });
      const failure = new AgentOperationError(code);
      handle.mockRejectedValue(failure);
      const response = await action(
        args(
          new Request("https://pages.invalid/api/v1/agents", {
            method: "POST",
            headers: {
              Authorization: "Bearer isolated-token",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              operation: "wiki.page.move",
              parameters: {},
            }),
          }),
        ),
      );
      expect(response.status).toBe(failure.status);
      expect(await response.json()).toEqual({
        apiVersion: "1",
        error: { code, message: failure.message, retryable: false },
      });
    },
  );
});

it.each(["import.structured.plan", "import.structured.apply"])(
  "dispatches authenticated structured operation %s with an unchanged envelope",
  async (operation) => {
    verify.mockResolvedValue({
      userId: "owner",
      isAdmin: false,
      permissions: ["write"],
    });
    const result = {
      apiVersion: "1",
      result: { marker: operation, items: [] },
    };
    handle.mockResolvedValue(result);
    const input = {
      operation,
      parameters: {
        manifest: { version: "1", sources: [] },
        operationId: "import",
        fingerprint: "a".repeat(64),
      },
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
    expect(await response.json()).toEqual(result);
    expect(handle).toHaveBeenCalledExactlyOnceWith("isolated-token", input);
  },
);
