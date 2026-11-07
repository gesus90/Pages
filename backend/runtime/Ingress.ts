import { createServer, request as httpRequest, Agent } from "node:http";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  SERVICE_STATUS_DETAILS_PATH,
  SERVICE_STATUS_PATH,
} from "@/definition/ServiceStatus";

import { AppRoutes } from "./AppRoutes";
import { requestTargetPath, serveAppDocument } from "./AppDocument";
import { isRemoteConsoleChannel, isRunnerChannel } from "./ChannelPaths";
import {
  createTrustedPeerCheck,
  readForwardedProtocol,
  UNSUPPORTED_FORWARDING_HEADERS,
} from "./ForwardedProtocol";
import { refuseMissingAsset, serveStaticAsset } from "./StaticAssets";

import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  Server,
  ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import type { PeerCheck } from "./ForwardedProtocol";

/** Where the entrance finds the static app and the API. */
export interface IngressOptions {
  /** Absolute path of the static app's files (`build/client`). */
  readonly clientDirectory: string;
  /** Origin of the API process, such as `http://127.0.0.1:3100`. */
  readonly backend: URL;
  /**
   * Origin of `pages-core`, such as `http://127.0.0.1:3200` (PAGE-237). Set:
   * `/live-changes` is served by the core. Missing: by the API, as before.
   */
  readonly core?: URL;
  /**
   * Origin of the `pages-core` that reports the service status, such as
   * `http://127.0.0.1:3200` (PAGE-238). Set: `/service-status` and its
   * details are served by it. Missing: they answer `404`.
   */
  readonly serviceStatus?: URL;
  /**
   * Origin of the `pages-core` that relays the runner channels (PAGE-239).
   * Set: their WebSocket upgrades go to the core. Missing: to the API.
   */
  readonly coreRunner?: URL;
  /**
   * Origin of the `pages-core` that relays the console channels (PAGE-239).
   * Set: their WebSocket upgrades go to the core. Missing: to the API.
   */
  readonly coreConsole?: URL;
  /**
   * Addresses or ranges of the proxies in front of the entrance whose
   * `X-Forwarded-*` headers are believed: the `trustedProxies` setting of the
   * instance, the one the API reads as well. Loopback peers are always
   * believed. Missing: loopback only.
   */
  readonly trustedProxies?: readonly string[];
}

/** Where a request goes, and which peers the entrance believes on the way. */
interface Forwarding {
  readonly backend: URL;
  readonly isTrustedPeer: PeerCheck;
}

/** The live stream of the pages; the switch decides who serves it. */
const LIVE_CHANGES_PATH = "/live-changes";
/** The service status of `pages-core`; never served by the API. */
const SERVICE_STATUS_PATHS: ReadonlySet<string> = new Set([
  SERVICE_STATUS_PATH,
  SERVICE_STATUS_DETAILS_PATH,
]);
/** The core's own API paths; only the core calls them, on the API's loopback port. */
const CORE_API_PREFIX = "/api/core/";

/** Headers that describe one connection and are never passed on. */
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Answer while the API cannot be reached; never kept by a cache. */
const BACKEND_UNAVAILABLE = {
  status: 502,
  body: "Pages backend unavailable",
  headers: {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  },
} as const;

/** Connections to the API are reused; a live stream holds one of its own. */
const BACKEND_AGENT = new Agent({ keepAlive: true });

function requestPathname(requestUrl: string | undefined): string | null {
  try {
    return decodeURIComponent(requestTargetPath(requestUrl));
  } catch (error: unknown) {
    logCaughtError("Ingress", error);
    return null;
  }
}

/**
 * The headers of one message that are not passed on: the fixed hop-by-hop
 * headers and every header its `Connection` header names (RFC 9110, 7.6.1).
 */
function connectionHeaders(headers: IncomingHttpHeaders): Set<string> {
  const named = (headerText(headers.connection) ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  return new Set([...HOP_BY_HOP_HEADERS, ...named]);
}

/** The end-to-end headers of a message. */
function endToEndHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const dropped = connectionHeaders(headers);
  const kept: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !dropped.has(name)) kept[name] = value;
  }
  return kept;
}

function headerText(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * The headers the API receives: the browser's, without connection headers,
 * and with the client the entrance saw.
 *
 * @remarks
 * `Host` stays, so the API compares a change's `Origin` with the address the
 * browser used. `X-Forwarded-For` and `X-Forwarded-Proto` are the entrance's
 * own: a client's values are replaced, and only a trusted peer, a loopback
 * proxy or an address of `trustedProxies`, is believed. `https` is passed on
 * only from such a peer, everything else as `http`. Headers of other
 * forwarding conventions are dropped.
 */
function backendHeaders(
  request: IncomingMessage,
  isUpgrade: boolean,
  isTrustedPeer: PeerCheck,
): OutgoingHttpHeaders {
  const headers = endToEndHeaders(request.headers);
  const peer = request.socket.remoteAddress ?? "";
  const isProxied = isTrustedPeer(peer);
  const forwardedFor = headerText(request.headers["x-forwarded-for"]);
  for (const name of UNSUPPORTED_FORWARDING_HEADERS) delete headers[name];
  headers["x-forwarded-for"] =
    isProxied && forwardedFor ? `${forwardedFor}, ${peer}` : peer;
  const reportedProtocol = readForwardedProtocol(
    request.headers["x-forwarded-proto"],
  );
  headers["x-forwarded-proto"] =
    isProxied && reportedProtocol === "https" ? "https" : "http";
  if (isUpgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = request.headers.upgrade ?? "";
  }
  return headers;
}

function answerUnavailable(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(BACKEND_UNAVAILABLE.status, BACKEND_UNAVAILABLE.headers);
  response.end(BACKEND_UNAVAILABLE.body);
}

/**
 * Passes a request to the API and its answer back, as it arrives.
 *
 * @remarks
 * Nothing is buffered: a live stream (`text/event-stream`) reaches the
 * browser event by event, and a closed browser connection ends the request
 * to the API, so the API releases the stream.
 */
function forwardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  forwarding: Forwarding,
): void {
  const { backend, isTrustedPeer } = forwarding;
  const upstream = httpRequest(
    {
      agent: BACKEND_AGENT,
      headers: backendHeaders(request, false, isTrustedPeer),
      host: backend.hostname,
      method: request.method,
      path: request.url,
      port: backend.port,
    },
    (answer) => {
      response.writeHead(
        answer.statusCode ?? 502,
        answer.statusMessage,
        endToEndHeaders(answer.headers),
      );
      response.flushHeaders();
      answer.pipe(response);
      answer.on("error", () => response.destroy());
    },
  );
  upstream.setNoDelay(true);
  upstream.on("error", (error: Error) => {
    logEvent({
      level: "warn",
      event: "ingress.backend.unavailable",
      component: "Ingress",
      message: "The API did not answer a forwarded request",
      error,
    });
    answerUnavailable(response);
  });
  response.on("close", () => {
    if (!response.writableFinished) upstream.destroy();
  });
  request.pipe(upstream);
}

function writeHead(
  socket: Duplex,
  status: number,
  message: string,
  headers: IncomingHttpHeaders | OutgoingHttpHeaders,
): void {
  const lines = [`HTTP/1.1 ${status} ${message}`];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      lines.push(`${name}: ${item}`);
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
}

/** Ends both connections of an upgrade once either of them is gone. */
function joinSockets(browser: Duplex, backendSocket: Duplex): void {
  backendSocket.pipe(browser);
  browser.pipe(backendSocket);
  backendSocket.on("error", () => browser.destroy());
  browser.on("close", () => backendSocket.destroy());
  backendSocket.on("close", () => browser.destroy());
}

/** Refuses an upgrade the entrance never passes on. */
function refuseUpgrade(socket: Duplex): void {
  socket.end(
    "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nNot Found",
  );
}

/**
 * Where an upgrade goes: runner and console channels to `pages-core` behind
 * their own switches, everything else to the API; `null` for `/api/core/`,
 * which only the core calls on the API's loopback port.
 */
function upgradeTarget(
  request: IncomingMessage,
  options: IngressOptions,
): URL | null {
  const pathname = requestPathname(request.url);
  if (pathname === null || pathname.startsWith(CORE_API_PREFIX)) return null;
  if (options.coreRunner && isRunnerChannel(request.url))
    return options.coreRunner;
  if (options.coreConsole && isRemoteConsoleChannel(request.url))
    return options.coreConsole;
  return options.backend;
}

/**
 * Passes a WebSocket upgrade, such as a runner or a console, to the API and
 * joins both connections once the API accepted it.
 *
 * @remarks
 * A browser that goes away before the API answered ends the request to the
 * API; after the switch, the end or failure of either connection ends the
 * other, so no half of an upgrade stays open. A refused upgrade is passed on
 * with its status and headers and a body that ends with the connection.
 */
function forwardUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  forwarding: Forwarding,
): void {
  const { backend, isTrustedPeer } = forwarding;
  const upstream = httpRequest({
    headers: backendHeaders(request, true, isTrustedPeer),
    host: backend.hostname,
    method: request.method,
    path: request.url,
    port: backend.port,
  });
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("upgrade", (answer, backendSocket, backendHead) => {
    if (socket.destroyed) {
      backendSocket.destroy();
      return;
    }
    writeHead(socket, 101, answer.statusMessage ?? "Switching Protocols", {
      ...answer.headers,
    });
    if (backendHead.length > 0) socket.write(backendHead);
    if (head.length > 0) backendSocket.write(head);
    joinSockets(socket, backendSocket);
  });
  upstream.on("response", (answer) => {
    writeHead(socket, answer.statusCode ?? 502, answer.statusMessage ?? "", {
      ...endToEndHeaders(answer.headers),
      connection: "close",
    });
    answer.pipe(socket);
    answer.on("error", () => socket.destroy());
  });
  upstream.on("error", () => {
    if (socket.destroyed) return;
    socket.end(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${BACKEND_UNAVAILABLE.body}`,
    );
  });
  upstream.end();
}

async function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: IngressOptions & {
    readonly routes: AppRoutes;
    readonly isTrustedPeer: PeerCheck;
  },
): Promise<void> {
  const method = request.method ?? "GET";
  const forward = (backend: URL): void =>
    forwardRequest(request, response, {
      backend,
      isTrustedPeer: options.isTrustedPeer,
    });
  const pathname = requestPathname(request.url);
  if (pathname === null) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }
  const isServiceStatus = SERVICE_STATUS_PATHS.has(pathname);
  if (isServiceStatus && options.serviceStatus) {
    forward(options.serviceStatus);
    return;
  }
  if (pathname.startsWith(CORE_API_PREFIX) || isServiceStatus) {
    response.writeHead(404, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not Found");
    return;
  }
  if (options.core && pathname === LIVE_CHANGES_PATH) {
    forward(options.core);
    return;
  }
  if (
    (await serveStaticAsset(request, response, options.clientDirectory)) ||
    refuseMissingAsset(request, response)
  )
    return;
  if (
    !(await options.routes.isForwarded(method, pathname)) &&
    (await serveAppDocument(
      { method, pathname },
      response,
      options.clientDirectory,
    ))
  )
    return;
  forward(options.backend);
}

/**
 * Creates the static app's entrance (PAGE-235).
 *
 * @param options - The static app's files and the API's origin.
 * @returns The HTTP server, not yet listening.
 *
 * @remarks
 * The entrance answers the hashed files and the app's document itself and
 * passes changes, data requests, server resources, live streams and
 * WebSocket upgrades to the API. With `core` the live stream goes to
 * `pages-core` instead; while the core is stopped, the stream answers 502 and
 * the pages fall back to reading again every minute, while everything else
 * keeps working. With `serviceStatus` the service status goes to
 * `pages-core` too, so it answers while the API is stopped; without it the
 * status does not exist. With `coreRunner` and `coreConsole` the runner and
 * console channels go to `pages-core`, each on its own switch; the core
 * relays them to the API, which still admits every one, and holds the
 * client's connection while the API restarts. `/api/core/` is never passed on, not even
 * as an upgrade. The entrance is the first hop that decides what a
 * forwarding header is worth: it believes loopback peers and the
 * `trustedProxies` of the instance, replaces the client's `X-Forwarded-*`
 * headers for every other peer and drops the headers of other conventions
 * (`deploy/proxy/README.md`). It holds no session, no database and no
 * application state, so the app still loads while the API is stopped; the
 * app then shows what the browser keeps. The entrance reads the build from
 * disk on every request, so a new build is served without a restart.
 */
export function createIngressServer(options: IngressOptions): Server {
  const routes = new AppRoutes(options.clientDirectory);
  // Loopback peers, such as a TLS proxy on the same host, may report the client.
  const isTrustedPeer = createTrustedPeerCheck(options.trustedProxies ?? [], {
    isLoopbackTrusted: true,
  });
  const answerOptions = { ...options, routes, isTrustedPeer };
  const server = createServer((request, response) => {
    void answerRequest(request, response, answerOptions).catch(
      (error: unknown) => {
        logCaughtError("Ingress", error);
        if (!response.headersSent) {
          response.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end("Internal Server Error");
        } else response.destroy();
      },
    );
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head) => {
    const target = upgradeTarget(request, options);
    if (target === null) refuseUpgrade(socket);
    else
      forwardUpgrade(request, socket, head, {
        backend: target,
        isTrustedPeer,
      });
  });
  // A live stream stays open for hours; only an idle request head times out.
  server.requestTimeout = 0;
  return server;
}
