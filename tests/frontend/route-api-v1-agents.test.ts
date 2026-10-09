import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

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
      const response = action(args(request));
      expect(request.bodyUsed).toBe(false);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "AUTH_REQUIRED",
          message: "Bearer authentication is required.",
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
      const response = action(args(request));
      expect(request.bodyUsed).toBe(false);
      expect(response.status).toBe(503);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "AUTH_NOT_READY",
          message: "Agent authentication is not available yet.",
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
      const response = method === "GET" ? loader(input) : action(input);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
      await expect(response.json()).resolves.toEqual({
        apiVersion: "1",
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST for the agent API.",
          retryable: false,
        },
      });
    },
  );
});
