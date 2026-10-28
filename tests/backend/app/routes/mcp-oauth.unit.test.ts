import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/mcp-oauth";

import {
  MCP_PUBLIC_URL,
  REMOTE_SOCKET,
  mcpRouteArguments,
} from "./mcp-route-arguments";

const BODY_LIMIT = 16384;

const fakes = vi.hoisted(() => ({
  getConfig: vi.fn(),
  begin:
    vi.fn<
      (
        parameters: URLSearchParams,
        resource: string,
        address: unknown,
      ) => Promise<string>
    >(),
  register: vi.fn(),
  exchange: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => ({ getConfig: fakes.getConfig }),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    oauthService: {
      begin: fakes.begin,
      register: fakes.register,
      exchange: fakes.exchange,
    },
  }),
}));
// The MCP SDK stays outside Pages unit tests; this stand-in reads bounded text bodies.
vi.mock("@modelcontextprotocol/server", () => ({
  readRequestBody: async (request: Request, limit: number) => {
    const text = await request.text();
    return text.length > limit ? { tooLarge: true } : { tooLarge: false, text };
  },
}));

beforeEach(() => {
  fakes.getConfig.mockReturnValue({
    port: 3000,
    mcpHttp: { publicUrl: MCP_PUBLIC_URL },
  });
});

function authorize(
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  return loader(
    mcpRouteArguments(
      new Request(
        `${MCP_PUBLIC_URL}/oauth/${endpoint}?client_id=c&state=s`,
        init,
      ),
      { endpoint },
    ),
  );
}

function post(
  endpoint: string,
  init: RequestInit & { readonly headers?: Record<string, string> },
): Promise<Response> {
  return action(
    mcpRouteArguments(
      new Request(`${MCP_PUBLIC_URL}/oauth/${endpoint}`, {
        method: "POST",
        ...init,
      }),
      { endpoint },
    ),
  );
}

async function errorOf(response: Response): Promise<[number, unknown]> {
  return [response.status, await response.json()];
}

it("begins an authorization request and redirects to the Pages login", async () => {
  fakes.begin.mockResolvedValue("request-1");
  const response = await authorize("authorize", {
    headers: { "X-Forwarded-For": "198.51.100.2" },
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/mcp-login?request=request-1");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const [parameters, resource, address] = fakes.begin.mock.calls[0] ?? [];
  expect(Object.fromEntries(parameters)).toEqual({
    client_id: "c",
    state: "s",
  });
  expect(resource).toBe(`${MCP_PUBLIC_URL}/mcp`);
  expect(address).toEqual({ socket: REMOTE_SOCKET, forwarded: "198.51.100.2" });
});

it("refuses other loader endpoints and untrusted origins", async () => {
  expect(await errorOf(await authorize("token"))).toEqual([
    405,
    { error: "invalid_request" },
  ]);
  expect(
    await errorOf(
      await authorize("authorize", {
        headers: { Origin: "https://foreign.invalid" },
      }),
    ),
  ).toEqual([403, { error: "access_denied" }]);
  expect(fakes.begin).not.toHaveBeenCalled();
});

it("registers a client from a JSON body", async () => {
  fakes.register.mockResolvedValue({ client_id: "client" });
  const response = await post("register", {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"] }),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ client_id: "client" });
  expect(fakes.register).toHaveBeenCalledWith(
    { redirect_uris: ["http://127.0.0.1/cb"] },
    { socket: REMOTE_SOCKET, forwarded: null },
  );
});

it.each([
  [{ body: "{}" }],
  [{ headers: { "Content-Type": "text/plain" }, body: "{}" }],
  [{ headers: { "Content-Type": "application/json" }, body: "{" }],
])("refuses a registration that is not valid JSON: %j", async (init) => {
  expect(await errorOf(await post("register", init))).toEqual([
    400,
    { error: "invalid_request" },
  ]);
  expect(fakes.register).not.toHaveBeenCalled();
});

it("exchanges a code from a form body for the protected resource", async () => {
  fakes.exchange.mockResolvedValue({ access_token: "token" });
  const response = await post("token", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=authorization_code&code=abc",
  });
  expect(await response.json()).toEqual({ access_token: "token" });
  expect(fakes.exchange).toHaveBeenCalledWith(
    { grant_type: "authorization_code", code: "abc" },
    `${MCP_PUBLIC_URL}/mcp`,
    { socket: REMOTE_SOCKET, forwarded: null },
  );
});

it.each([
  ["token", {}, "invalid_request"],
  ["token", { "Content-Type": "application/json" }, "invalid_request"],
  [
    "revoke",
    { "Content-Type": "application/x-www-form-urlencoded" },
    "invalid_request",
  ],
  [
    "token",
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic abc",
    },
    "invalid_client",
  ],
])(
  "refuses the %s request with headers %j as %s",
  async (endpoint, headers, code) => {
    expect(
      await errorOf(await post(endpoint, { headers, body: "code=abc" })),
    ).toEqual([400, { error: code }]);
    expect(fakes.exchange).not.toHaveBeenCalled();
  },
);

it("refuses other methods, oversized bodies and untrusted origins", async () => {
  expect(await errorOf(await post("token", { method: "PUT" }))).toEqual([
    405,
    { error: "invalid_request" },
  ]);
  expect(
    await errorOf(await post("token", { body: "x".repeat(BODY_LIMIT + 1) })),
  ).toEqual([413, { error: "invalid_request" }]);
  expect(
    await errorOf(
      await post("token", { headers: { Origin: "https://foreign.invalid" } }),
    ),
  ).toEqual([403, { error: "access_denied" }]);
});
