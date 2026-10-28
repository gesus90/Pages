import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/mcp";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { MCP_PUBLIC_URL, mcpRouteArguments } from "./mcp-route-arguments";

const TOKEN = "token_ABC-123";
const METADATA = `${MCP_PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`;

const fakes = vi.hoisted(() => ({
  getConfig: vi.fn(),
  authenticate: vi.fn(),
  createHttpMcpServer: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  handleRequest: vi.fn(),
  transportOptions: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => ({ getConfig: fakes.getConfig }),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    oauthService: { authenticate: fakes.authenticate },
    pagesAgentApiService: "agent-api",
  }),
}));
vi.mock("@/backend/service/mcp/HttpMcpOperations", () => ({
  createHttpMcpServer: fakes.createHttpMcpServer,
}));
// The MCP SDK stays outside Pages unit tests; this stand-in records its use.
vi.mock("@modelcontextprotocol/server", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    /** Records the options the route configures. */
    public constructor(options: unknown) {
      fakes.transportOptions(options);
    }

    /** Answers the request through the recorded fake. */
    public handleRequest(request: Request): Promise<Response> {
      return fakes.handleRequest(request);
    }
  },
}));

beforeEach(() => {
  fakes.getConfig.mockReturnValue({
    port: 3000,
    mcpHttp: { publicUrl: MCP_PUBLIC_URL },
  });
  fakes.authenticate.mockResolvedValue(undefined);
  fakes.createHttpMcpServer.mockReturnValue({
    connect: fakes.connect,
    close: fakes.close,
  });
});

function mcpRequest(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${MCP_PUBLIC_URL}/mcp`, {
    method,
    headers,
    body: method === "POST" ? "{}" : null,
  });
}

it("serves a POST through a fresh stateless transport and closes the server", async () => {
  fakes.handleRequest.mockResolvedValue(
    Response.json({ jsonrpc: "2.0" }, { headers: { "X-Kept": "yes" } }),
  );
  const request = mcpRequest("POST", { Authorization: `bearer ${TOKEN}` });
  const response = await action(mcpRouteArguments(request, {}));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Kept")).toBe("yes");
  expect(fakes.authenticate).toHaveBeenCalledWith(
    TOKEN,
    `${MCP_PUBLIC_URL}/mcp`,
  );
  expect(fakes.createHttpMcpServer).toHaveBeenCalledWith("agent-api", TOKEN);
  expect(fakes.transportOptions).toHaveBeenCalledWith({
    enableJsonResponse: true,
    maxRequestBodySize: 65536,
  });
  expect(fakes.handleRequest).toHaveBeenCalledWith(request);
  expect(fakes.close).toHaveBeenCalledOnce();
});

it("closes the server also when the transport fails", async () => {
  fakes.handleRequest.mockRejectedValue(new Error("transport"));
  const response = await action(
    mcpRouteArguments(
      mcpRequest("POST", { Authorization: `Bearer ${TOKEN}` }),
      {},
    ),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("WWW-Authenticate")).toBeNull();
  expect(fakes.close).toHaveBeenCalledOnce();
});

it.each([[{}], [{ Authorization: "Basic abc" }]])(
  "challenges a request without a bearer token %j",
  async (headers) => {
    const response = await loader(
      mcpRouteArguments(mcpRequest("GET", headers), {}),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${METADATA}", scope="pages", error="invalid_token"`,
    );
    expect(fakes.authenticate).not.toHaveBeenCalled();
  },
);

it("challenges a token the OAuth service rejects", async () => {
  fakes.authenticate.mockRejectedValue(
    new McpAuthorizationError("invalid_token", 401),
  );
  const response = await action(
    mcpRouteArguments(
      mcpRequest("POST", { Authorization: `Bearer ${TOKEN}` }),
      {},
    ),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toContain(METADATA);
});

it("refuses a session id and methods other than POST after authentication", async () => {
  const withSession = await action(
    mcpRouteArguments(
      mcpRequest("POST", {
        Authorization: `Bearer ${TOKEN}`,
        "Mcp-Session-Id": "session",
      }),
      {},
    ),
  );
  expect(withSession.status).toBe(400);
  const stream = await loader(
    mcpRouteArguments(
      mcpRequest("GET", { Authorization: `Bearer ${TOKEN}` }),
      {},
    ),
  );
  expect(stream.status).toBe(405);
  expect(stream.headers.get("Allow")).toBe("POST");
  expect(fakes.authenticate).toHaveBeenCalledTimes(2);
  expect(fakes.createHttpMcpServer).not.toHaveBeenCalled();
});

it("answers 404 without a metadata challenge while MCP HTTP is off", async () => {
  fakes.getConfig.mockReturnValue({ port: 3000 });
  const response = await action(mcpRouteArguments(mcpRequest("POST"), {}));
  expect(response.status).toBe(404);
  expect(response.headers.get("WWW-Authenticate")).toBeNull();
});
