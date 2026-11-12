import type { Server } from "node:http";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIngressServer } from "@/backend/runtime/Ingress";
import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import { createStaticExchange } from "./static-asset-exchange";

vi.mock("@/backend/runtime/StaticAssets", () => ({
  serveStaticAsset: vi.fn(async () => false),
  refuseMissingAsset: vi.fn(() => false),
}));
vi.mock("@/backend/runtime/AppRoutes", () => ({
  AppRoutes: class {
    /** Keeps requests on the document path in this fixture. */
    public async isForwarded(): Promise<boolean> {
      return false;
    }
  },
}));
vi.mock("@/backend/runtime/AppDocument", async (original) => ({
  ...(await original<object>()),
  serveAppDocument: vi.fn(async () => true),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ingress request routing", () => {
  it.each(["/api/core/private", "/service-status", "/service-status/details"])(
    "refuses private or unavailable paths: %s",
    async (url) => {
      const server = createIngressServer({
        clientDirectory: "/client",
        backend: new URL("http://127.0.0.1:4100"),
      });
      const exchange = createStaticExchange("GET", url);

      server.emit("request", exchange.request, exchange.response);
      await exchange.finished;

      expect(exchange.status()).toBe(404);
      expect(exchange.headers()?.["Cache-Control"]).toBe("no-store");
      expect(serveStaticAsset).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed encoded paths", async () => {
    const server = createIngressServer({
      clientDirectory: "/client",
      backend: new URL("http://127.0.0.1:4100"),
    });
    const exchange = createStaticExchange("GET", "/%invalid");

    server.emit("request", exchange.request, exchange.response);
    await exchange.finished;

    expect(exchange.status()).toBe(400);
  });

  it("refuses private upgrades without opening a connection", () => {
    const server: Server = createIngressServer({
      clientDirectory: "/client",
      backend: new URL("http://127.0.0.1:4100"),
    });
    const exchange = createStaticExchange("GET", "/api/core/private");
    const socket = new PassThrough();
    const end = vi.spyOn(socket, "end");

    server.emit("upgrade", exchange.request, socket, Buffer.alloc(0));

    expect(end).toHaveBeenCalledWith(expect.stringContaining("404 Not Found"));
    expect(server.requestTimeout).toBe(0);
  });
});
