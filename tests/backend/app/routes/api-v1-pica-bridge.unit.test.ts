import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/api-v1-pica-bridge";
import { PICA_BRIDGE_MAXIMUM_BODY } from "@/backend/service/chat/acp/PicaBridge";

import { routeArguments } from "../server-lib/route-arguments";

import type {
  PicaBridgeRequest,
  PicaBridgeResponse,
} from "@/backend/service/chat/acp/PicaBridge";

const bridge = vi.hoisted(() => ({
  handle: vi.fn<(request: PicaBridgeRequest) => Promise<PicaBridgeResponse>>(),
  isConfigured: true,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    picaBridge: bridge.isConfigured ? { handle: bridge.handle } : null,
  }),
}));

const URL_OF_BRIDGE = "http://pages.invalid/api/v1/pica-bridge";

function bridgeRequest(init: RequestInit = {}): Request {
  return new Request(URL_OF_BRIDGE, init);
}

beforeEach(() => {
  bridge.isConfigured = true;
});

it("answers 404 without a configured bridge", async () => {
  bridge.isConfigured = false;
  const response = await action(
    routeArguments(bridgeRequest({ method: "POST" }), null, {}),
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

it("passes method, token, signal and a bounded body reader and returns the JSON answer", async () => {
  bridge.handle.mockImplementation(async (request: PicaBridgeRequest) => ({
    status: 200,
    body: { echoed: await request.readBody() },
  }));
  const response = await action(
    routeArguments(
      bridgeRequest({
        method: "POST",
        headers: { Authorization: "Bearer job" },
        body: "payload",
      }),
      null,
      {},
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Mcp-Session-Id")).toBeNull();
  expect(response.headers.get("Allow")).toBeNull();
  expect(await response.json()).toEqual({ echoed: "payload" });
  expect(bridge.handle).toHaveBeenCalledWith(
    expect.objectContaining({ method: "POST", authorization: "Bearer job" }),
  );
  expect(bridge.handle.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
});

it("refuses to read a body that declares more than the bridge limit", async () => {
  let readResult: string | null = "unread";
  bridge.handle.mockImplementation(async (request: PicaBridgeRequest) => {
    readResult = await request.readBody();
    return { status: 413, body: null };
  });
  const response = await action(
    routeArguments(
      bridgeRequest({
        method: "POST",
        headers: { "Content-Length": String(PICA_BRIDGE_MAXIMUM_BODY + 1) },
        body: "x",
      }),
      null,
      {},
    ),
  );
  expect(readResult).toBeNull();
  expect(response.status).toBe(413);
  expect(response.headers.get("Mcp-Session-Id")).toBeNull();
  expect(await response.text()).toBe("");
});

it("answers the stream loader with 405 and the allowed methods", async () => {
  bridge.handle.mockImplementation(async (request: PicaBridgeRequest) => {
    expect(request.authorization).toBeNull();
    expect(await request.readBody()).toBe("");
    return { status: 405, body: null };
  });
  const response = await loader(routeArguments(bridgeRequest(), null, {}));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(bridge.handle).toHaveBeenCalledWith(
    expect.objectContaining({ method: "GET" }),
  );
});
