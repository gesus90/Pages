import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/api-v1-agents";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  pagesAgentApiService: { handle: vi.fn(), verify: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const api = services.pagesAgentApiService;
const ADDRESS = "https://pages.invalid/api/v1/agents";
const BODY = JSON.stringify({ operation: "projects.list", parameters: {} });

beforeEach(() => {
  vi.resetAllMocks();
});

async function post(authorization: string | null): Promise<Response> {
  return action(
    routeArguments(
      new Request(ADDRESS, {
        body: BODY,
        headers: {
          "Content-Type": "application/json",
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        method: "POST",
      }),
      null,
      {},
    ),
  );
}

async function errorCode(response: Response): Promise<unknown> {
  const body: unknown = await response.json();

  return typeof body === "object" && body !== null && "error" in body
    ? body.error
    : null;
}

it("verifies the personal token before handling the operation", async () => {
  api.handle.mockResolvedValue({ apiVersion: "1", result: [] });

  const response = await post("Bearer synthetic.token-1==");

  expect(api.verify).toHaveBeenCalledWith("synthetic.token-1==");
  expect(api.handle).toHaveBeenCalledWith("synthetic.token-1==", {
    operation: "projects.list",
    parameters: {},
  });
  expect(api.verify.mock.invocationCallOrder[0]).toBeLessThan(
    api.handle.mock.invocationCallOrder[0] ?? 0,
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.json()).toEqual({ apiVersion: "1", result: [] });
});

it("answers a read with the JSON method error", async () => {
  const response = await loader(routeArguments(new Request(ADDRESS), null, {}));

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(await errorCode(response)).toMatchObject({
    code: "METHOD_NOT_ALLOWED",
  });
});

it.each([
  ["no credential", null],
  ["a basic credential", "Basic dXNlcjpwdw=="],
  ["a malformed bearer", "Bearer two words"],
])("asks for a token with %s", async (caseName, authorization) => {
  const response = await post(authorization);

  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  expect(await errorCode(response)).toMatchObject({ code: "AUTH_REQUIRED" });
  expect(api.verify).not.toHaveBeenCalled();
});

it.each([
  [new McpAuthorizationError("invalid_token", 401), 401, "AUTH_INVALID"],
  [new McpAuthorizationError("insufficient_scope", 403), 403, "FORBIDDEN"],
  [new McpAuthorizationError("invalid_request", 400), 400, "INVALID_REQUEST"],
  [new Error("database closed"), 503, "AUTH_UNAVAILABLE"],
])("maps a verification failure to %i %s", async (failure, status, code) => {
  api.verify.mockRejectedValue(failure);

  const response = await post("Bearer synthetic");

  expect(response.status).toBe(status);
  expect(await errorCode(response)).toMatchObject({ code });
  expect(api.handle).not.toHaveBeenCalled();
});

it("passes an operation refusal on with its details", async () => {
  api.handle.mockRejectedValue(
    new AgentOperationError("CONFLICT", { currentRevision: 4 }),
  );

  const response = await post("Bearer synthetic");

  expect(response.status).toBe(409);
  expect(await errorCode(response)).toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 4 },
  });
});
