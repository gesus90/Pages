import OAuth2Server from "@node-oauth/oauth2-server";
import { beforeEach, expect, it, vi } from "vitest";

import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
  uniqueOAuthParameters,
} from "@/app/lib/mcp-http.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

interface FakeConfiguration {
  readonly port: number;
  readonly mcpHttp?: { readonly publicUrl?: string };
}

const runtime = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => runtime,
}));

const PUBLIC_URL = "https://pages.invalid";
const LOOPBACK = "127.0.0.1";

function configure(configuration: FakeConfiguration): void {
  runtime.getConfig.mockReturnValue(configuration);
}

function request(url: string, origin?: string): Request {
  return new Request(url, {
    headers: origin === undefined ? {} : { Origin: origin },
  });
}

async function refusal(work: Promise<unknown>): Promise<McpAuthorizationError> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof McpAuthorizationError) return error;
    throw error;
  }
  throw new Error("Expected an authorization refusal.");
}

beforeEach(() => {
  vi.resetAllMocks();
  configure({ mcpHttp: { publicUrl: PUBLIC_URL }, port: 3000 });
});

it("answers 404 while HTTP MCP is not configured", async () => {
  for (const configuration of [{ port: 3000 }, { mcpHttp: {}, port: 3000 }]) {
    configure(configuration);

    const error = await refusal(
      requireMcpHttp(request(`${PUBLIC_URL}/mcp`), LOOPBACK),
    );

    expect([error.code, error.status]).toEqual(["not_found", 404]);
  }
});

it("accepts the public HTTPS address from any socket", async () => {
  expect(
    await requireMcpHttp(
      request(`${PUBLIC_URL}/mcp`, PUBLIC_URL),
      "203.0.113.9",
    ),
  ).toEqual({ origin: PUBLIC_URL, resource: `${PUBLIC_URL}/mcp` });
});

it.each([["127.0.0.1"], ["::1"], ["::ffff:127.0.0.1"]])(
  "accepts the local HTTP address from the loopback socket %s",
  async (socket) => {
    const url = "http://localhost:3000/mcp";

    expect(
      await requireMcpHttp(request(url, "http://localhost:3000"), socket),
    ).toEqual({
      origin: PUBLIC_URL,
      resource: `${PUBLIC_URL}/mcp`,
    });
  },
);

it.each([
  ["a non-loopback socket", "http://127.0.0.1:3000/mcp", "192.168.0.5"],
  ["another port", "http://127.0.0.1:3001/mcp", LOOPBACK],
  ["a non-loopback host", "http://pages.lan:3000/mcp", LOOPBACK],
  ["an HTTPS loopback address", "https://127.0.0.1:3000/mcp", LOOPBACK],
  ["a foreign HTTPS address", "https://other.invalid/mcp", LOOPBACK],
])("refuses %s", async (caseName, url, socket) => {
  const error = await refusal(requireMcpHttp(request(url), socket));

  expect([error.code, error.status]).toEqual(["access_denied", 403]);
});

it("refuses the public address when it is plain HTTP", async () => {
  configure({ mcpHttp: { publicUrl: "http://pages.invalid" }, port: 3000 });

  const error = await refusal(
    requireMcpHttp(request("http://pages.invalid/mcp"), "203.0.113.9"),
  );

  expect([error.code, error.status]).toEqual(["access_denied", 403]);
});

it("refuses a browser request from another origin", async () => {
  const error = await refusal(
    requireMcpHttp(
      request(`${PUBLIC_URL}/mcp`, "https://evil.invalid"),
      LOOPBACK,
    ),
  );

  expect([error.code, error.status]).toEqual(["access_denied", 403]);
});

it.each([["access_token"], ["token"], ["deviceSecret"], ["refresh_token"]])(
  "refuses a credential in the query parameter %s",
  async (name) => {
    const error = await refusal(
      requireMcpHttp(request(`${PUBLIC_URL}/mcp?${name}=secret`), LOOPBACK),
    );

    expect([error.code, error.status]).toEqual(["invalid_request", 400]);
  },
);

async function failureOf(error: unknown): Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}> {
  const response = mcpHttpFailure(error);

  return {
    body: await response.json(),
    headers: response.headers,
    status: response.status,
  };
}

it("answers an authorization refusal with its code and status", async () => {
  const outcome = await failureOf(
    new McpAuthorizationError("access_denied", 403),
  );

  expect(outcome.status).toBe(403);
  expect(outcome.body).toEqual({ error: "access_denied" });
  for (const [name, value] of Object.entries(MCP_HTTP_HEADERS))
    expect(outcome.headers.get(name)).toBe(value);
  expect(outcome.headers.has("Retry-After")).toBe(false);
});

it("tells a throttled client when to retry", async () => {
  const outcome = await failureOf(new PairingRateError(30));

  expect(outcome.status).toBe(429);
  expect(outcome.body).toEqual({ error: "slow_down" });
  expect(outcome.headers.get("Retry-After")).toBe("30");
});

it("keeps a known OAuth error name", async () => {
  const error = new OAuth2Server.InvalidClientError("client secret leaked");

  const outcome = await failureOf(error);

  expect(outcome.status).toBe(400);
  expect(outcome.body).toEqual({ error: "invalid_client" });
});

it("replaces an unknown OAuth error name", async () => {
  const error = new OAuth2Server.ServerError("provider diagnostics");

  const outcome = await failureOf(error);

  expect(outcome.status).toBe(400);
  expect(outcome.body).toEqual({ error: "invalid_grant" });
});

it("answers any other failure as unavailable", async () => {
  const outcome = await failureOf(new Error("database secret"));

  expect(outcome.status).toBe(503);
  expect(outcome.body).toEqual({ error: "server_error" });
});

it("collects unique OAuth parameters", () => {
  expect(
    uniqueOAuthParameters(new URLSearchParams("client_id=a&state=b")),
  ).toEqual({ client_id: "a", state: "b" });
});

it.each([
  ["a repeated parameter", "state=a&state=b"],
  ["an overlong name", `${"k".repeat(101)}=a`],
  ["an overlong value", `state=${"v".repeat(4097)}`],
])("refuses %s", (caseName, query) => {
  expect(() => uniqueOAuthParameters(new URLSearchParams(query))).toThrow(
    McpAuthorizationError,
  );
});
