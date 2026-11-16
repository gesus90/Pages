import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { IncomingMessage } from "node:http";

const boundary = vi.hoisted(() => ({
  request: vi.fn(),
  server: vi.fn(),
  caught: vi.fn(),
}));
vi.mock("node:http", () => ({
  request: boundary.request,
  createServer: boundary.server,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: boundary.caught,
}));

import { PicaMobileRelay } from "@/backend/service/mobile/PicaMobileRelay";
import { PAGES_CORE_RELAY_HEADERS } from "@/definition/PagesCoreContract";

function incoming(
  secret: string,
  contract: string,
  client: string,
): IncomingMessage {
  return partial<IncomingMessage>({
    headers: {
      [PAGES_CORE_RELAY_HEADERS.secret]: secret,
      [PAGES_CORE_RELAY_HEADERS.contract]: contract,
      [PAGES_CORE_RELAY_HEADERS.client]: client,
    },
  });
}

describe("Pica mobile relay", () => {
  beforeEach(() => vi.resetAllMocks());

  it("admits only requests with the shared secret, contract and IP address", () => {
    const relay = new PicaMobileRelay({ port: 1234, secret: "secret" });
    expect(relay.port).toBe(1234);
    expect(relay.admit(incoming("Bearer secret", "1", "::1"))).toBe("::1");
    expect(relay.admit(incoming("Bearer wrong", "1", "::1"))).toBeNull();
    expect(relay.admit(incoming("Bearer secret", "2", "::1"))).toBeNull();
    expect(
      relay.admit(incoming("Bearer secret", "1", "host.invalid")),
    ).toBeNull();
    expect(relay.admit(partial<IncomingMessage>({ headers: {} }))).toBeNull();
    expect(relay.receiveProbe("/wrong?relayProbe=unknown")).toBe(false);
    expect(relay.receiveProbe(undefined)).toBe(false);
  });

  it("confirms only a probe relayed back with its fresh token", async () => {
    const relay = new PicaMobileRelay({ port: 1234, secret: "secret" });
    boundary.request.mockImplementation((options, respond) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end: () => {
          expect(options.host).toBe("127.0.0.1");
          expect(relay.receiveProbe(options.path)).toBe(true);
          const response = new EventEmitter();
          Object.assign(response, { resume: vi.fn() });
          respond(response);
          response.emit("end");
        },
      });
      return request;
    });
    expect(await relay.confirm("0.0.0.0", 4321)).toBe(true);
    expect(relay.receiveProbe("/api/mobile?relayProbe=unknown")).toBe(false);
  });

  it("returns false for a failed probe", async () => {
    const relay = new PicaMobileRelay({ port: 1234, secret: "secret" });
    boundary.request.mockImplementation(() => {
      const request = new EventEmitter();
      Object.assign(request, {
        end: () => request.emit("error", new Error("offline")),
      });
      return request;
    });
    expect(await relay.confirm("127.0.0.1", 4321)).toBe(false);
    expect(boundary.caught).toHaveBeenCalledOnce();
  });

  it.each([
    ["EADDRINUSE", "portInUse"],
    ["EACCES", "permissionDenied"],
    ["OTHER", "listenFailed"],
  ])("classifies a simulated bind error %s", async (code, result) => {
    boundary.server.mockImplementation(() => {
      const server = new EventEmitter();
      Object.assign(server, {
        listen: () =>
          server.emit("error", Object.assign(new Error("bind"), { code })),
      });
      return server;
    });
    const relay = new PicaMobileRelay({ port: 1234, secret: "secret" });
    expect(await relay.checkPort(undefined, 4321)).toBe(result);
  });

  it("closes a successfully simulated port check", async () => {
    const close = vi.fn((callback: () => void) => callback());
    boundary.server.mockReturnValue({
      once: vi.fn(),
      listen: (port: number, host: string, callback: () => void) => {
        expect(port).toBe(4321);
        expect(host).toBe("127.0.0.1");
        callback();
      },
      close,
    });
    const relay = new PicaMobileRelay({ port: 1234, secret: "secret" });
    expect(await relay.checkPort("127.0.0.1", 4321)).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});
