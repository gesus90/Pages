import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { PICA_MOBILE_PATH } from "@/definition/PicaMobile";
import { PICA_MOBILE_MAXIMUM_MESSAGE_BYTES } from "@/definition/PicaMobileProtocol";

import { PicaMobileConnection } from "./PicaMobileConnection";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import type { PicaMobilePortError } from "@/definition/PicaMobile";
import type { PicaMobileAuthenticator } from "./PicaMobileAuthenticator";

/** What the gateway needs from its surroundings. */
export interface PicaMobileGatewayOptions {
  readonly authenticator: PicaMobileAuthenticator;
  /** Version of this Pages build, reported to connected clients. */
  readonly serverVersion: string;
  /** Interface to listen on; every interface when missing. */
  readonly listenAddress?: string;
  /** Port of the Pages web server, which the endpoint can never share. */
  readonly reservedPort?: number;
  /** Creates the HTTP server of a listener; tests replace it. */
  readonly createHttpServer?: () => Server;
  /** Creates the WebSocket handling of a listener; tests replace it. */
  readonly createSocketServer?: () => WebSocketServer;
}

/** Raised when the endpoint cannot listen on a port; nothing has changed then. */
export class PicaMobileListenError extends Error {
  /** What the administrator is told. */
  public readonly reason: PicaMobilePortError;

  /**
   * Creates the error.
   *
   * @param reason - Why the port cannot be used.
   * @param options - Original error, when there is one.
   */
  public constructor(reason: PicaMobilePortError, options?: ErrorOptions) {
    super(`Pica Mobile cannot listen on the port: ${reason}.`, options);
    this.name = "PicaMobileListenError";
    this.reason = reason;
  }
}

/** The last port the endpoint failed to bind, with the reason. */
export interface PicaMobileListenFailure {
  readonly port: number;
  readonly reason: PicaMobilePortError;
}

interface Listener {
  readonly port: number;
  readonly server: Server;
  readonly sockets: WebSocketServer;
  readonly connections: Set<PicaMobileConnection>;
}

const COMPONENT = "PicaMobileGateway";
const MAXIMUM_CONNECTIONS = 100;
const MAXIMUM_USER_AGENT_LENGTH = 200;
const SHUTDOWN_GRACE_MILLISECONDS = 3_000;

function classifyListenError(error: unknown): PicaMobilePortError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;

  if (code === "EADDRINUSE") {
    return "portInUse";
  }

  return code === "EACCES" ? "permissionDenied" : "listenFailed";
}

function listen(
  server: Server,
  port: number,
  address: string | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function rawDataToText(frame: RawData): string {
  if (Array.isArray(frame)) {
    return Buffer.concat(frame).toString("utf8");
  }

  return frame instanceof ArrayBuffer
    ? Buffer.from(frame).toString("utf8")
    : frame.toString("utf8");
}

function readUserAgent(request: IncomingMessage): string | null {
  const header = request.headers["user-agent"];

  return typeof header === "string"
    ? header.slice(0, MAXIMUM_USER_AGENT_LENGTH)
    : null;
}

function isEndpointPath(url: string | undefined): boolean {
  try {
    return new URL(url ?? "/", "http://pica-mobile.invalid").pathname === PICA_MOBILE_PATH;
  } catch {
    return false;
  }
}

/**
 * The WebSocket endpoint of Pica Mobile: one listener on its own port, the
 * connections it accepts, and a controlled move to another port.
 *
 * @remarks
 * Moving binds the new port first, lets the caller store it, and only then
 * closes the old listener, so a port that cannot be bound or stored leaves the
 * working listener and its connections untouched. A single instance serves the
 * process.
 */
export class PicaMobileGateway {
  private readonly options: PicaMobileGatewayOptions;
  private readonly changes = new SerialQueue();
  private active: Listener | null = null;
  private lastFailure: PicaMobileListenFailure | null = null;
  private isClosed = false;

  /**
   * Creates the gateway; it listens once {@link PicaMobileGateway.switchTo} ran.
   *
   * @param options - Authentication, address and test hooks.
   */
  public constructor(options: PicaMobileGatewayOptions) {
    this.options = options;
  }

  /** Port the endpoint listens on, or `null` while it listens nowhere. */
  public get port(): number | null {
    return this.active?.port ?? null;
  }

  /** Number of connections that are open right now. */
  public get connectionCount(): number {
    return this.active?.connections.size ?? 0;
  }

  /** The last port that could not be bound; kept until a bind succeeds. */
  public get failure(): PicaMobileListenFailure | null {
    return this.lastFailure;
  }

  /**
   * Makes the endpoint listen on a port.
   *
   * @param port - Port to listen on.
   * @param commit - Stores the port; runs after the port is bound and before
   * the previous listener is closed. When it fails, the new listener is closed
   * and the previous one stays.
   * @throws {PicaMobileListenError} When the port cannot be bound.
   *
   * @remarks
   * Changes run one after another.
   */
  public switchTo(port: number, commit: () => Promise<void>): Promise<void> {
    return this.changes.run(async () => {
      if (this.isClosed) {
        throw new PicaMobileListenError("listenFailed");
      }

      if (port === this.options.reservedPort) {
        this.noteFailure(port, "portOfPages");

        throw new PicaMobileListenError("portOfPages");
      }

      if (this.active?.port === port) {
        await commit();

        return;
      }

      const next = await this.openListener(port);

      try {
        await commit();
      } catch (error: unknown) {
        await this.closeListener(next, "Pica Mobile port change failed");

        throw error;
      }

      const previous = this.active;

      this.active = next;
      this.lastFailure = null;
      logEvent({
        level: "info",
        event: "pica_mobile.listener.started",
        component: COMPONENT,
        message: "Pica Mobile endpoint is listening",
        metadata: { port },
      });

      if (previous !== null) {
        await this.closeListener(previous, "Pica Mobile port changed");
      }
    });
  }

  /** Closes the listener and every connection; the gateway cannot listen again. */
  public close(): Promise<void> {
    return this.changes.run(async () => {
      this.isClosed = true;

      const previous = this.active;

      this.active = null;

      if (previous !== null) {
        await this.closeListener(previous, "Pages is stopping");
      }
    });
  }

  private noteFailure(port: number, reason: PicaMobilePortError): void {
    this.lastFailure = { port, reason };
    logEvent({
      level: "error",
      event: "pica_mobile.listener.failed",
      component: COMPONENT,
      message: "Pica Mobile endpoint cannot listen on the port",
      metadata: { port, reason },
    });
  }

  private async openListener(port: number): Promise<Listener> {
    const listener: Listener = {
      port,
      server: (this.options.createHttpServer ?? createServer)(),
      sockets:
        this.options.createSocketServer?.() ??
        new WebSocketServer({
          noServer: true,
          maxPayload: PICA_MOBILE_MAXIMUM_MESSAGE_BYTES,
        }),
      connections: new Set(),
    };

    listener.server.on("upgrade", (request, socket, head) =>
      this.handleUpgrade(listener, { request, socket, head }),
    );
    listener.server.on("request", (request, response) => {
      response.writeHead(426, {
        "Content-Type": "text/plain; charset=utf-8",
        Upgrade: "websocket",
      });
      response.end("Pica Mobile speaks WebSocket only.");
    });

    try {
      await listen(listener.server, port, this.options.listenAddress);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      const reason = classifyListenError(error);

      this.noteFailure(port, reason);

      throw new PicaMobileListenError(reason, { cause: error });
    }

    listener.server.on("error", (error) => logCaughtError(COMPONENT, error));

    return listener;
  }

  private handleUpgrade(
    listener: Listener,
    upgrade: {
      readonly request: IncomingMessage;
      readonly socket: Duplex;
      readonly head: Buffer;
    },
  ): void {
    const { request, socket, head } = upgrade;

    // A peer that resets during the handshake must not raise an unhandled error.
    socket.on("error", () => socket.destroy());

    if (!isEndpointPath(request.url)) {
      refuseUpgrade(socket, 404, "Not Found");

      return;
    }

    if (listener.connections.size >= MAXIMUM_CONNECTIONS) {
      logEvent({
        level: "warn",
        event: "pica_mobile.connection.refused",
        component: COMPONENT,
        message: "Pica Mobile connection refused: connection limit reached",
        metadata: { count: listener.connections.size },
      });
      refuseUpgrade(socket, 503, "Service Unavailable");

      return;
    }

    listener.sockets.handleUpgrade(request, socket, head, (channel) =>
      this.accept(listener, channel, request),
    );
  }

  private accept(
    listener: Listener,
    channel: WebSocket,
    request: IncomingMessage,
  ): void {
    const connection = new PicaMobileConnection(channel, {
      connectionId: randomUUID(),
      origin: {
        clientAddress: request.socket.remoteAddress ?? null,
        userAgent: readUserAgent(request),
      },
      authenticator: this.options.authenticator,
      serverVersion: this.options.serverVersion,
    });

    listener.connections.add(connection);
    channel.on("message", (frame, isBinary) => {
      if (isBinary) {
        connection.receiveBinary();
      } else {
        connection.receiveText(rawDataToText(frame));
      }
    });
    channel.on("pong", () => connection.receivePong());
    channel.on("error", (error) => {
      logCaughtError(COMPONENT, error);

      logEvent({
        level: "warn",
        event: "pica_mobile.connection.error",
        component: COMPONENT,
        message: "Pica Mobile connection failed",
      });
    });
    channel.once("close", (code) => {
      listener.connections.delete(connection);
      connection.stop(code);
    });
    connection.start();
    logEvent({
      level: "info",
      event: "pica_mobile.connection.opened",
      component: COMPONENT,
      message: "Pica Mobile connection opened",
      metadata: { count: listener.connections.size },
    });
  }

  private async closeListener(
    listener: Listener,
    reason: string,
  ): Promise<void> {
    const count = listener.connections.size;

    for (const connection of listener.connections) {
      connection.closeGoingAway(reason);
    }

    const forceClose = setTimeout(() => {
      listener.server.closeAllConnections();
    }, SHUTDOWN_GRACE_MILLISECONDS);

    forceClose.unref();
    await new Promise<void>((resolve) => {
      listener.server.close(() => resolve());
      listener.server.closeIdleConnections();
    });
    clearTimeout(forceClose);
    listener.sockets.close();
    logEvent({
      level: "info",
      event: "pica_mobile.listener.closed",
      component: COMPONENT,
      message: "Pica Mobile endpoint stopped listening",
      metadata: { port: listener.port, count },
    });
  }
}
