import { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  PicaMobileGateway,
  PicaMobileListenError,
} from "@/backend/service/mobile/PicaMobileGateway";

import { sessionAuth } from "./pica-mobile-fixture";
import {
  acceptNextUpgrade,
  createGatewayWorld,
  createUpgrade,
  listenFailure,
} from "./pica-mobile-gateway-fixture";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const stored = vi.fn(async () => undefined);

async function connect(
  world: ReturnType<typeof createGatewayWorld>,
  index = 0,
): Promise<ReturnType<typeof acceptNextUpgrade>> {
  const listener = world.listeners[index];
  const channel = acceptNextUpgrade(listener);
  const attempt = createUpgrade("/pica-mobile", { "user-agent": "okhttp/4" });

  listener.server.emit("upgrade", attempt.request, attempt.socket, Buffer.alloc(0));
  await vi.waitFor(() => expect(world.gateway.connectionCount).toBeGreaterThan(0));

  return channel;
}

describe("listening", () => {
  it("binds the port, stores it and reports it", async () => {
    const world = createGatewayWorld([], { listenAddress: "192.168.0.52" });

    await world.gateway.switchTo(3001, stored);

    expect(world.gateway.port).toBe(3001);
    expect(world.gateway.failure).toBeNull();
    expect(world.listeners[0].listen).toHaveBeenCalledWith(
      3001,
      "192.168.0.52",
      expect.any(Function),
    );
    expect(stored).toHaveBeenCalledTimes(1);
  });

  it("listens on every interface without a listen address", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);

    expect(world.listeners[0].listen).toHaveBeenCalledWith(
      3001,
      undefined,
      expect.any(Function),
    );
  });

});

describe("binding failures", () => {
  it.each([
    ["EADDRINUSE", "portInUse"],
    ["EACCES", "permissionDenied"],
    ["EINVAL", "listenFailed"],
  ] as const)("reports %s as %s and changes nothing", async (code, reason) => {
    const world = createGatewayWorld([{ failure: listenFailure(code) }]);
    const commit = vi.fn(async () => undefined);

    await expect(world.gateway.switchTo(80, commit)).rejects.toMatchObject({
      name: "PicaMobileListenError",
      reason,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(world.gateway.port).toBeNull();
    expect(world.gateway.failure).toEqual({ port: 80, reason });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "pica_mobile.listener.failed",
        metadata: { port: 80, reason },
      }),
    );
  });

  it("treats an error without a code as a general failure", async () => {
    const world = createGatewayWorld([{ failure: new Error("boom") }]);

    await expect(world.gateway.switchTo(80, stored)).rejects.toMatchObject({
      reason: "listenFailed",
    });
  });

  it("refuses the port of the Pages web server without binding", async () => {
    const world = createGatewayWorld([], { reservedPort: 3000 });

    await expect(world.gateway.switchTo(3000, stored)).rejects.toMatchObject({
      reason: "portOfPages",
    });

    expect(world.listeners).toHaveLength(0);
    expect(world.gateway.failure).toEqual({ port: 3000, reason: "portOfPages" });
  });

  it("runs the store step without rebinding the port it already listens on", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    await world.gateway.switchTo(3001, stored);

    expect(world.listeners).toHaveLength(1);
    expect(stored).toHaveBeenCalledTimes(2);
  });

  it("runs changes one after another", async () => {
    const world = createGatewayWorld();
    const order: string[] = [];

    await Promise.all([
      world.gateway.switchTo(3001, async () => {
        order.push("first");
      }),
      world.gateway.switchTo(3002, async () => {
        order.push("second");
      }),
    ]);

    expect(order).toEqual(["first", "second"]);
    expect(world.gateway.port).toBe(3002);
  });

  it("uses real HTTP and WebSocket servers unless told otherwise", async () => {
    const listen = vi
      .spyOn(Server.prototype, "listen")
      .mockImplementation(function (this: Server, ...parameters: unknown[]) {
        const callback = parameters.find((entry) => typeof entry === "function");

        queueMicrotask(() => (callback as (() => void) | undefined)?.());

        return this;
      });
    const close = vi
      .spyOn(Server.prototype, "close")
      .mockImplementation(function (this: Server, callback?: () => void) {
        queueMicrotask(() => callback?.());

        return this;
      });
    const gateway = new PicaMobileGateway({
      authenticator: createGatewayWorld().authenticator,
      serverVersion: "9.9.9",
    });

    await gateway.switchTo(3001, stored);
    await gateway.close();

    expect(listen).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("moving to another port", () => {
  it("binds first, stores, then closes the old listener with its connections", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);
    const order: string[] = [];

    world.listeners[0].close.mockImplementation((callback) => {
      order.push("closed old");
      queueMicrotask(() => callback?.());

      return world.listeners[0].server;
    });
    await world.gateway.switchTo(3002, async () => {
      order.push("stored");
    });

    expect(order).toEqual(["stored", "closed old"]);
    expect(world.gateway.port).toBe(3002);
    expect(channel.close).toHaveBeenCalledWith(1001, "Pica Mobile port changed");
  });

  it("keeps the working listener and its connections when the new port is taken", async () => {
    const world = createGatewayWorld([{}, { failure: listenFailure("EADDRINUSE") }]);

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    await expect(world.gateway.switchTo(3002, stored)).rejects.toBeInstanceOf(
      PicaMobileListenError,
    );

    expect(world.gateway.port).toBe(3001);
    expect(world.gateway.connectionCount).toBe(1);
    expect(world.listeners[0].close).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
  });

  it("drops the new listener and keeps the old one when storing fails", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    await expect(
      world.gateway.switchTo(3002, async () => {
        throw new Error("config file is read-only");
      }),
    ).rejects.toThrow("config file is read-only");

    expect(world.gateway.port).toBe(3001);
    expect(world.listeners[1].close).toHaveBeenCalledTimes(1);
    expect(world.listeners[0].close).not.toHaveBeenCalled();
  });

  it("forgets an earlier failure once a port is bound", async () => {
    const world = createGatewayWorld([{ failure: listenFailure("EADDRINUSE") }]);

    await expect(world.gateway.switchTo(3001, stored)).rejects.toBeInstanceOf(
      PicaMobileListenError,
    );
    await world.gateway.switchTo(3002, stored);

    expect(world.gateway.failure).toBeNull();
  });
});

describe("shutdown", () => {
  it("closes every connection and cannot listen again", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);
    await world.gateway.close();

    expect(channel.close).toHaveBeenCalledWith(1001, "Pages is stopping");
    expect(world.gateway.port).toBeNull();
    await expect(world.gateway.switchTo(3003, stored)).rejects.toMatchObject({
      reason: "listenFailed",
    });
  });

  it("closes without a listener", async () => {
    const world = createGatewayWorld();

    await expect(world.gateway.close()).resolves.toBeUndefined();
  });

  it("cuts off connections that outlive the grace period", async () => {
    vi.useFakeTimers();

    try {
      const world = createGatewayWorld();

      await world.gateway.switchTo(3001, stored);
      const closeAll = vi.spyOn(world.listeners[0].server, "closeAllConnections");

      world.listeners[0].close.mockImplementation(() => world.listeners[0].server);
      const closing = world.gateway.close();

      await vi.advanceTimersByTimeAsync(3_000);
      expect(closeAll).toHaveBeenCalledTimes(1);
      world.listeners[0].close.mock.calls[0][0]?.();
      await closing;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("accepting connections", () => {
  it("serves the authentication protocol on an accepted socket", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    channel.emit("message", Buffer.from(sessionAuth("auth-1")), false);
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledTimes(1));

    expect(world.authenticator.authenticate).toHaveBeenCalledWith(
      { method: "session", token: "session-token-anna" },
      { clientAddress: "192.168.0.7", userAgent: "okhttp/4" },
    );
    expect(JSON.parse(String(vi.mocked(channel.send).mock.calls[0][0]))).toMatchObject(
      { type: "connected", requestId: "auth-1" },
    );
  });

  it("reads fragmented and binary-typed text frames", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);
    const text = Buffer.from(sessionAuth("auth-2"));

    channel.emit(
      "message",
      [text.subarray(0, 10), text.subarray(10)],
      false,
    );
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledTimes(1));
    channel.emit(
      "message",
      text.buffer.slice(text.byteOffset, text.byteOffset + text.length),
      false,
    );
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledTimes(2));

    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("answers a binary frame with an error", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    channel.emit("message", Buffer.from([1, 2, 3]), true);

    expect(JSON.parse(String(vi.mocked(channel.send).mock.calls[0][0]))).toMatchObject(
      { type: "error", payload: { code: "invalid_message" } },
    );
  });

  it("forgets a connection once its socket closed", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    channel.emit("close", 1000, Buffer.alloc(0));

    expect(world.gateway.connectionCount).toBe(0);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "pica_mobile.connection.closed" }),
    );
  });

  it("logs a socket error without crashing", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    channel.emit("error", new Error("ECONNRESET"));

    expect(logCaughtError).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "pica_mobile.connection.error" }),
    );
  });

  it("answers the pong of a socket", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = await connect(world);

    expect(() => channel.emit("pong", Buffer.alloc(0))).not.toThrow();
  });

});

describe("refusing connections", () => {
  it("refuses a path other than the endpoint", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const attempt = createUpgrade("/other");

    world.listeners[0].server.emit(
      "upgrade",
      attempt.request,
      attempt.socket,
      Buffer.alloc(0),
    );

    expect(attempt.written.join("")).toContain("404 Not Found");
    expect(world.gateway.connectionCount).toBe(0);
  });

  it("refuses an unreadable address", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const attempt = createUpgrade("//[broken");

    world.listeners[0].server.emit(
      "upgrade",
      attempt.request,
      attempt.socket,
      Buffer.alloc(0),
    );

    expect(attempt.written.join("")).toContain("404 Not Found");
  });

  it("accepts the endpoint path with a query", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const channel = acceptNextUpgrade(world.listeners[0]);
    const attempt = createUpgrade("/pica-mobile?client=app");

    world.listeners[0].server.emit(
      "upgrade",
      attempt.request,
      attempt.socket,
      Buffer.alloc(0),
    );

    expect(world.gateway.connectionCount).toBe(1);
    expect(channel.listenerCount("message")).toBe(1);
  });

  it("refuses connections beyond the limit", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    for (let count = 0; count < 100; count += 1) {
      acceptNextUpgrade(world.listeners[0]);
      const attempt = createUpgrade("/pica-mobile");

      world.listeners[0].server.emit(
        "upgrade",
        attempt.request,
        attempt.socket,
        Buffer.alloc(0),
      );
    }
    const refused = createUpgrade("/pica-mobile");

    world.listeners[0].server.emit(
      "upgrade",
      refused.request,
      refused.socket,
      Buffer.alloc(0),
    );

    expect(world.gateway.connectionCount).toBe(100);
    expect(refused.written.join("")).toContain("503 Service Unavailable");
  });

});

describe("keeping the server running", () => {
  it("survives a peer that resets during the handshake", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const attempt = createUpgrade("/other");

    world.listeners[0].server.emit(
      "upgrade",
      attempt.request,
      attempt.socket,
      Buffer.alloc(0),
    );

    expect(() => attempt.socket.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(attempt.socket.destroyed).toBe(true);
  });

  it("answers plain HTTP requests with 426", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);
    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    world.listeners[0].server.emit("request", {}, response);

    expect(response.writeHead).toHaveBeenCalledWith(
      426,
      expect.objectContaining({ Upgrade: "websocket" }),
    );
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("logs a server error after listening instead of crashing", async () => {
    const world = createGatewayWorld();

    await world.gateway.switchTo(3001, stored);

    expect(() =>
      world.listeners[0].server.emit("error", new Error("EMFILE")),
    ).not.toThrow();
    expect(logCaughtError).toHaveBeenCalled();
  });

  it("starts without connections", () => {
    expect(createGatewayWorld().gateway.connectionCount).toBe(0);
  });
});
