import { IncomingMessage, Server } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";

import { vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { PicaMobileGateway } from "@/backend/service/mobile/PicaMobileGateway";

import { FakeAuthenticator } from "./pica-mobile-fixture";

import type { Mock } from "vitest";

/** A port that is taken, as the operating system reports it. */
export function listenFailure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** An HTTP server that records `listen` and never opens a socket. */
export interface FakeListener {
  readonly server: Server;
  readonly sockets: WebSocketServer;
  readonly listen: Mock<Server["listen"]>;
  readonly close: Mock<Server["close"]>;
}

/** What one fake listener does when the gateway binds it. */
export interface ListenerScript {
  readonly failure?: Error;
}

/** A gateway on fake servers, with every listener it created. */
export interface GatewayWorld {
  readonly gateway: PicaMobileGateway;
  readonly authenticator: FakeAuthenticator;
  readonly listeners: FakeListener[];
}

function createListener(script: ListenerScript): FakeListener {
  const server = new Server();
  const listen = vi
    .spyOn(server, "listen")
    .mockImplementation((...parameters: unknown[]): Server => {
      const callback = parameters.find(
        (parameter) => typeof parameter === "function",
      );

      queueMicrotask(() => {
        if (script.failure !== undefined) {
          server.emit("error", script.failure);
        } else if (typeof callback === "function") {
          callback();
        }
      });

      return server;
    });
  const close = vi
    .spyOn(server, "close")
    .mockImplementation((callback?: (error?: Error) => void): Server => {
      queueMicrotask(() => callback?.());

      return server;
    });

  return {
    server,
    sockets: new WebSocketServer({ noServer: true }),
    listen,
    close,
  };
}

/**
 * Builds a gateway whose listeners are fake servers.
 *
 * @param scripts - What each successive listener does when it is bound.
 * @param options - Reserved port and listen address.
 */
export function createGatewayWorld(
  scripts: readonly ListenerScript[] = [],
  options: { reservedPort?: number; listenAddress?: string } = {},
): GatewayWorld {
  const listeners: FakeListener[] = [];
  const authenticator = new FakeAuthenticator();
  const gateway = new PicaMobileGateway({
    authenticator,
    serverVersion: "9.9.9",
    ...options,
    createHttpServer: () => {
      const listener = createListener(scripts[listeners.length] ?? {});

      listeners.push(listener);

      return listener.server;
    },
    createSocketServer: () => {
      const listener = listeners[listeners.length - 1];

      if (listener === undefined) {
        throw new Error("The HTTP server is created first.");
      }

      return listener.sockets;
    },
  });

  return { gateway, authenticator, listeners };
}

/** `ws` builds the server side of a connection with these arguments; the typings only show the first. */
const ServerSideWebSocket: new (
  address: null,
  protocols: undefined,
  options: { autoPong: boolean },
) => WebSocket = WebSocket;

/** What a test needs to observe an upgrade attempt. */
export interface UpgradeAttempt {
  readonly written: string[];
  readonly socket: Duplex;
  readonly request: IncomingMessage;
}

/** Builds the arguments of an `upgrade` event without any real connection. */
export function createUpgrade(
  url: string,
  headers: Record<string, string> = {},
): UpgradeAttempt {
  const written: string[] = [];
  const socket = new Duplex({
    read(): void {},
    write(chunk: Buffer, _: BufferEncoding, done): void {
      written.push(chunk.toString());
      done();
    },
  });
  const request = new IncomingMessage(new Socket());

  request.url = url;
  Object.assign(request.headers, headers);
  Object.defineProperty(request.socket, "remoteAddress", {
    value: "192.168.0.7",
  });

  return { written, socket, request };
}

/**
 * Lets the next upgrade on a listener succeed with a socket the test controls.
 *
 * @returns The server-side WebSocket the gateway will talk to.
 */
export function acceptNextUpgrade(listener: FakeListener): WebSocket {
  const channel = new ServerSideWebSocket(null, undefined, { autoPong: true });

  vi.spyOn(channel, "send").mockImplementation(() => undefined);
  vi.spyOn(channel, "close").mockImplementation(() => undefined);
  vi.spyOn(channel, "ping").mockImplementation(() => undefined);
  vi.spyOn(channel, "terminate").mockImplementation(() => undefined);
  vi.spyOn(listener.sockets, "handleUpgrade").mockImplementation(
    (...upgrade) => upgrade[3](channel, upgrade[0]),
  );

  return channel;
}
