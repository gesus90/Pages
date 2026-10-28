import { beforeEach, expect, it, vi } from "vitest";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { action, loader } from "@/app/routes/api-v1-pairing";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  pairingService: { begin: vi.fn(), cancel: vi.fn(), exchange: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const pairing = services.pairingService;

beforeEach(() => {
  vi.resetAllMocks();
});

async function call(
  endpoint: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  const request = new Request("https://pages.invalid/api/v1/pairing", {
    body: JSON.stringify({ client: "synthetic" }),
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.9, 10.0.0.1",
    },
    method: "POST",
    ...init,
  });
  const routeArgs = routeArguments(
    request,
    null,
    endpoint === undefined ? {} : { endpoint },
  );
  routeArgs.context.set(clientSocketAddressContext, "192.0.2.1");

  return action(routeArgs);
}

it("begins a pairing with the socket and the forwarded address", async () => {
  pairing.begin.mockResolvedValue({ deviceCode: "d1" });

  const response = await call(undefined);

  expect(pairing.begin).toHaveBeenCalledWith(
    { client: "synthetic" },
    { socket: "192.0.2.1", forwarded: "203.0.113.9" },
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ deviceCode: "d1" });
});

it.each([
  ["token", "exchange"],
  ["cancel", "cancel"],
] as const)("serves the %s endpoint", async (endpoint, method) => {
  pairing[method].mockResolvedValue({ status: endpoint });

  const response = await call(endpoint);

  expect(pairing[method]).toHaveBeenCalledWith({ client: "synthetic" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: endpoint });
});

it("answers an unknown endpoint with 404", async () => {
  const response = await call("approve");

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "invalid_request" });
  expect(pairing.begin).not.toHaveBeenCalled();
});

it("refuses anything but a device POST", async () => {
  const response = await call(undefined, { method: "PUT" });

  expect(response.status).toBe(405);
  expect(pairing.begin).not.toHaveBeenCalled();
});

it("tells a polling device when to try again", async () => {
  pairing.exchange.mockRejectedValue(new PairingRateError(5));

  const response = await call("token");

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("5");
  expect(await response.json()).toEqual({ error: "slow_down" });
});

it("hides an internal failure behind a temporary error", async () => {
  pairing.begin.mockRejectedValue(new Error("database closed"));

  const response = await call(undefined);

  expect(response.status).toBe(503);
  expect(response.headers.has("Retry-After")).toBe(false);
  expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
});

it("rejects reads without revealing any state", async () => {
  const response = loader();

  expect(response.status).toBe(405);
  expect(await response.json()).toEqual({ error: "invalid_request" });
});
