import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/mcp-discovery";

import { MCP_PUBLIC_URL, mcpRouteArguments } from "./mcp-route-arguments";

const runtime = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => runtime,
}));

beforeEach(() => {
  runtime.getConfig.mockReturnValue({
    port: 3000,
    mcpHttp: { publicUrl: MCP_PUBLIC_URL },
  });
});

function discover(
  path: string,
  params: { readonly document: string; readonly resource?: string },
): Promise<Response> {
  return loader(
    mcpRouteArguments(
      new Request(`${MCP_PUBLIC_URL}/.well-known/${path}`),
      params,
    ),
  );
}

it("describes the protected MCP resource with its authorization server", async () => {
  const response = await discover("oauth-protected-resource/mcp", {
    document: "oauth-protected-resource",
    resource: "mcp",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    resource: `${MCP_PUBLIC_URL}/mcp`,
    authorization_servers: [MCP_PUBLIC_URL],
    scopes_supported: ["pages"],
    bearer_methods_supported: ["header"],
  });
});

it("describes the authorization server endpoints", async () => {
  const response = await discover("oauth-authorization-server", {
    document: "oauth-authorization-server",
  });
  expect(await response.json()).toMatchObject({
    issuer: MCP_PUBLIC_URL,
    authorization_endpoint: `${MCP_PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${MCP_PUBLIC_URL}/oauth/token`,
    registration_endpoint: `${MCP_PUBLIC_URL}/oauth/register`,
    code_challenge_methods_supported: ["S256"],
  });
});

it.each([
  [{ document: "" }],
  [{ document: "openid-configuration" }],
  [{ document: "oauth-authorization-server", resource: "mcp" }],
  [{ document: "oauth-protected-resource", resource: "other" }],
])("answers unknown documents %j with 404", async (params) => {
  const response = await discover("unknown", params);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

it("hides the documents while MCP HTTP is not configured", async () => {
  runtime.getConfig.mockReturnValue({ port: 3000 });
  const response = await discover("oauth-authorization-server", {
    document: "oauth-authorization-server",
  });
  expect(response.status).toBe(404);
});
