import { randomUUID } from "node:crypto";

import { WebSocketServer } from "ws";

import { readSessionToken } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { logCaughtError } from "@/backend/logging/Logger";
import { sharedConversationAnswerStream } from "@/backend/service/conversation/ConversationAnswerStream";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import { PicaMobileConnection } from "@/backend/service/mobile/PicaMobileConnection";
import { PicaMobileWebAuthenticator } from "@/backend/service/mobile/PicaMobileWebAuthenticator";
import { PICA_MOBILE_MAXIMUM_CHAT_SEND_BYTES } from "@/definition/PicaMobileProtocol";
import { PAGES_VERSION } from "@/definition/Version";

import { isConversationWebChannel } from "./ChannelPaths";
import { createForwardedHttpsCheck } from "./ForwardedProtocol";
import { createMobileConversations } from "./PicaMobileRuntime";
import { registerShutdownTask } from "./ProcessLifecycle";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import type { PicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import type { PicaMobileConversationsProvider } from "@/backend/service/mobile/conversations/PicaMobileConversationsProvider";

const COMPONENT = "ConversationWebChannel";
const MAXIMUM_CHANNELS = 500;
const UPGRADE_DEADLINE = 10_000;
const MAXIMUM_USER_AGENT_LENGTH = 200;

/** What an accepted upgrade has proven: the browser's own origin and a session that holds. */
export interface ConversationWebAdmission {
  readonly sessionToken: string;
  readonly origin: string;
}

/** What the channel needs from its surroundings; tests replace them. */
export interface ConversationWebChannelOptions {
  readonly trustedProxies?: readonly string[];
  readonly authenticator?: PicaMobileAuthenticator;
  readonly conversations?: PicaMobileConversationsProvider;
  readonly createConnectionId?: () => string;
}

/** Raised when an upgrade is refused; the status goes to the browser. */
class ChannelRefusal extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(`The conversation channel was refused with ${status}.`);
    this.name = "ChannelRefusal";
    this.status = status;
  }
}

function refuseUpgrade(socket: Duplex, error: unknown): void {
  const status = error instanceof ChannelRefusal ? error.status : 503;
  socket.end(
    `HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function rawDataToText(frame: RawData): string {
  if (Array.isArray(frame)) return Buffer.concat(frame).toString("utf8");
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

/**
 * Checks origin and sign-in before the channel of a browser opens.
 *
 * @param request - The upgrade request.
 * @param context - Decides the protocol behind a proxy and checks sessions.
 * @returns The session of the cookie and the origin of the page.
 * @throws {ChannelRefusal} 403 for a foreign origin, 401 without a session
 * that may use the web.
 *
 * @remarks
 * Only the browser's own Pages origin may open the channel, so a foreign
 * page cannot use the session cookie.
 */
export async function admitConversationWebChannel(
  request: IncomingMessage,
  context: {
    readonly isForwardedHttps: (request: IncomingMessage) => boolean;
    readonly authenticator: PicaMobileAuthenticator;
  },
): Promise<ConversationWebAdmission> {
  const host = request.headers.host;
  const origin = `${context.isForwardedHttps(request) ? "https" : "http"}://${host}`;
  if (!host || request.headers.origin !== origin) throw new ChannelRefusal(403);
  const sessionToken = await readSessionToken(request.headers.cookie ?? null);
  if (
    sessionToken === null ||
    !(await context.authenticator.isSessionActive(sessionToken))
  )
    throw new ChannelRefusal(401);
  return { sessionToken, origin };
}

function attach(
  channel: WebSocket,
  request: IncomingMessage,
  setup: {
    readonly admission: ConversationWebAdmission;
    readonly authenticator: PicaMobileAuthenticator;
    readonly conversations: PicaMobileConversationsProvider;
    readonly connectionId: string;
  },
): void {
  const connection = new PicaMobileConnection(channel, {
    connectionId: setup.connectionId,
    origin: {
      clientAddress: request.socket.remoteAddress ?? null,
      userAgent: readUserAgent(request),
    },
    authenticator: new PicaMobileWebAuthenticator(
      setup.authenticator,
      setup.admission.sessionToken,
    ),
    conversations: setup.conversations,
    answers: sharedConversationAnswerStream(),
    handshakeOrigin: setup.admission.origin,
    serverVersion: PAGES_VERSION,
  });
  channel.on("message", (frame, isBinary) => {
    if (isBinary) connection.receiveBinary();
    else connection.receiveText(rawDataToText(frame));
  });
  channel.on("pong", () => connection.receivePong());
  channel.on("error", (error) => logCaughtError(COMPONENT, error));
  channel.once("close", (code) => connection.stop(code));
  connection.start();
}

/**
 * Serves `conversations.v1` to the chat page of the signed-in browser on the
 * Pages port.
 * @param server - The Pages HTTP server.
 * @param settings - Proxies whose `X-Forwarded-Proto` is believed, and test hooks.
 * @remarks
 * The connection is the one of Pica Mobile with the same messages, rights
 * and session checks, bound to the session of the page's cookie. It offers
 * only `conversations.v1`, with the parts of the answers agents are writing
 * (`conversations.stream.v1`). Upgrades of other paths are left to their own
 * handlers.
 */
export function installConversationWebChannel(
  server: Server,
  settings: ConversationWebChannelOptions = {},
): void {
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: PICA_MOBILE_MAXIMUM_CHAT_SEND_BYTES,
    perMessageDeflate: false,
  });
  const isForwardedHttps = createForwardedHttpsCheck(
    settings.trustedProxies ?? [],
  );
  const authenticator =
    settings.authenticator ??
    new PagesPicaMobileAuthenticator(
      async () => (await getApplicationServices()).authService,
    );
  const conversations = settings.conversations ?? createMobileConversations();
  const createConnectionId = settings.createConnectionId ?? randomUUID;
  server.on("upgrade", (request, socket, head) => {
    if (!isConversationWebChannel(request.url)) return;
    socket.on("error", () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), UPGRADE_DEADLINE);
    void (async () => {
      try {
        if (websocket.clients.size >= MAXIMUM_CHANNELS)
          throw new ChannelRefusal(503);
        const admission = await admitConversationWebChannel(request, {
          isForwardedHttps,
          authenticator,
        });
        websocket.handleUpgrade(request, socket, head, (channel) =>
          attach(channel, request, {
            admission,
            authenticator,
            conversations,
            connectionId: createConnectionId(),
          }),
        );
      } catch (error: unknown) {
        if (!(error instanceof ChannelRefusal))
          logCaughtError(COMPONENT, error);
        refuseUpgrade(socket, error);
      } finally {
        clearTimeout(deadline);
      }
    })();
  });
  registerShutdownTask(
    () => {
      for (const channel of websocket.clients) channel.terminate();
      websocket.close();
      return Promise.resolve();
    },
    { step: "conversation_web_channel" },
  );
}
