import { WebSocketServer } from "ws";
import { z } from "zod";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { RemoteError, remoteErrorStatus } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { consoleCommandSchema } from "@/definition/RemoteConsole";

import { createForwardedHttpsCheck } from "./ForwardedProtocol";
import { registerShutdownTask } from "./ProcessLifecycle";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import type {
  RemoteConsoleScope,
  RemoteConsoleService,
} from "@/backend/service/remote/RemoteConsoleService";
import type { RemoteConsoleSession } from "@/backend/service/remote/RemoteConsoleSession";
import type { RemoteConsoleEvent } from "@/definition/RemoteConsole";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The channel lives next to the console route it belongs to. */
const CHANNEL_PATHS: readonly {
  readonly pattern: RegExp;
  readonly kind: RemoteConsoleScope["kind"];
}[] = [
  {
    pattern: new RegExp(`^/agents/workspaces/(${UUID})/console/socket$`, "u"),
    kind: "workspace",
  },
  {
    pattern: new RegExp(
      `^/agents/workspaces/remote/connections/(${UUID})/console/socket$`,
      "u",
    ),
    kind: "connection",
  },
  {
    pattern: new RegExp(
      `^/agents/workspaces/remote/connections/(${UUID})/setup/socket$`,
      "u",
    ),
    kind: "setup",
  },
];
const MAXIMUM_CHANNELS = 100;
const MAXIMUM_PAYLOAD = 64 * 1024;
/** Output waits for acknowledgements long before this; reaching it means a stuck peer. */
const MAXIMUM_BUFFERED = 1024 * 1024;
const MAXIMUM_PENDING_COMMANDS = 64;
/**
 * Output the browser has not yet processed. Above the high mark the channel
 * holds further events, below the low mark it sends them from the session
 * history. The terminal itself is always read: the shared OpenSSH master
 * writes to it blockingly and would stop every session of the connection.
 */
const OUTPUT_HIGH_WATER = 128 * 1024;
const OUTPUT_LOW_WATER = 32 * 1024;
/**
 * A rights check reads the account and the target from the database, which
 * costs more than the round trip of a keystroke. Input within this time of a
 * successful check is written at once; later input waits for a new check.
 */
const RIGHTS_VALIDITY = 2000;
/** While someone types, the check is renewed in the background after this time. */
const RIGHTS_REFRESH = 1000;
/** Rights, lease and liveness are checked at this interval while nothing is typed. */
const CHECK_MILLISECONDS = 15_000;
const UPGRADE_DEADLINE = 10_000;
const CLOSE_SUPERSEDED = 4001;
const CLOSE_DENIED = 4003;
const CLOSE_OVERFLOW = 4008;

/** What an accepted upgrade has proven: the person, the console and its current rights. */
interface ChannelAdmission {
  readonly userId: string;
  readonly scope: RemoteConsoleScope;
  readonly sessionId: string;
  readonly after: number;
  readonly consoles: RemoteConsoleService;
  readonly session: RemoteConsoleSession;
}

function scopeOf(pathname: string): RemoteConsoleScope | null {
  for (const { pattern, kind } of CHANNEL_PATHS) {
    const id = pattern.exec(pathname)?.[1];
    if (id) return { kind, id };
  }
  return null;
}

/**
 * Whether an upgrade request addresses a console channel.
 *
 * @param url - The request target, path and query.
 * @returns `true` for the channel path of a workspace, connection or setup console.
 */
export function isRemoteConsoleChannel(url: string | undefined): boolean {
  // A malformed absolute request target must not throw inside the upgrade event.
  if (!URL.canParse(url ?? "/", "http://pages.invalid")) return false;
  return scopeOf(new URL(url ?? "/", "http://pages.invalid").pathname) !== null;
}

function rejectUpgrade(socket: Duplex, error: unknown): void {
  const status =
    error instanceof RemoteError ? remoteErrorStatus(error.code) : 400;
  socket.end(
    `HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Checks origin, sign-in, ownership and current rights before a channel opens.
 *
 * @remarks
 * Only the browser's own Pages origin may open a channel, so a foreign page
 * cannot use the session cookie. The URL names the console and the replay
 * cursor, never a machine or a credential.
 */
async function admit(
  request: IncomingMessage,
  isForwardedHttps: (request: IncomingMessage) => boolean,
): Promise<ChannelAdmission> {
  const url = new URL(request.url ?? "/", "http://pages.invalid");
  const scope = scopeOf(url.pathname);
  const host = request.headers.host;
  const origin = `${isForwardedHttps(request) ? "https" : "http"}://${host}`;
  if (!scope || !host || request.headers.origin !== origin)
    throw new RemoteError("remote_access_denied");
  const sessionId = z.uuid().parse(url.searchParams.get("sessionId"));
  const after = z.coerce
    .number()
    .int()
    .min(0)
    .parse(url.searchParams.get("after") ?? 0);
  const user = await getAuthenticatedUser(
    new Request(origin, { headers: { Cookie: request.headers.cookie ?? "" } }),
  );
  if (!user || user.mustChangePassword)
    throw new RemoteError("remote_access_denied");
  const consoles = (await getApplicationServices()).remoteConsoleService;
  const session = await consoles.require(user.id, scope, sessionId);
  return { userId: user.id, scope, sessionId, after, consoles, session };
}

/**
 * The current rights of one channel, never trusted for longer than
 * {@link RIGHTS_VALIDITY}.
 */
class ChannelRights {
  private readonly check: () => Promise<void>;
  private readonly onRefused: () => void;
  private verifiedAt = Date.now();
  private renewal: Promise<void> | null = null;

  /**
   * @param check - Rechecks ownership and rights; rejects when they are gone.
   * @param onRefused - Ends the channel after a background check failed.
   */
  public constructor(check: () => Promise<void>, onRefused: () => void) {
    this.check = check;
    this.onRefused = onRefused;
  }

  /** Resolves once the rights are known to hold, checking anew when they are too old. */
  public async require(): Promise<void> {
    const age = Date.now() - this.verifiedAt;
    if (age > RIGHTS_REFRESH) void this.renew().catch(this.onRefused);
    if (age > RIGHTS_VALIDITY) await this.renew();
  }

  /** Checks now; concurrent callers share one check. */
  public renew(): Promise<void> {
    this.renewal ??= this.check()
      .then(() => {
        this.verifiedAt = Date.now();
      })
      .finally(() => {
        this.renewal = null;
      });
    return this.renewal;
  }
}

function parseCommand(
  raw: RawData,
  isBinary: boolean,
): ReturnType<typeof consoleCommandSchema.parse> {
  if (isBinary || !(raw instanceof Buffer))
    throw new RemoteError("remote_workspace_invalid");
  return consoleCommandSchema.parse(JSON.parse(raw.toString("utf8")));
}

/** Sends one terminal event; a peer that stops reading is disconnected, never buffered without bound. */
function deliver(channel: WebSocket, event: RemoteConsoleEvent): void {
  if (channel.readyState !== channel.OPEN) return;
  if (channel.bufferedAmount > MAXIMUM_BUFFERED) {
    channel.close(CLOSE_OVERFLOW, "Console output overflow");
    return;
  }
  channel.send(JSON.stringify(event));
  if (event.kind === "state" && event.state.status === "ended")
    channel.close(1000, "Console ended");
}

/**
 * The output side of one channel: events in order, held while the browser
 * is behind and taken from the bounded history once it caught up.
 */
class ChannelOutput {
  private readonly channel: WebSocket;
  private readonly session: RemoteConsoleSession;
  private sent: number;
  private unacknowledged = 0;
  private isHolding = false;

  /**
   * @param channel - The open channel.
   * @param session - The followed console.
   * @param after - Sequence of the last event the browser already has.
   */
  public constructor(
    channel: WebSocket,
    session: RemoteConsoleSession,
    after: number,
  ) {
    this.channel = channel;
    this.session = session;
    this.sent = after;
  }

  /** Sends an event unless output is held; held events stay in the history. */
  public readonly deliver = (event: RemoteConsoleEvent): void => {
    if (this.isHolding) return;
    deliver(this.channel, event);
    this.sent = Math.max(this.sent, event.sequence);
    if (event.kind !== "output") return;
    this.unacknowledged += event.chunk.length;
    this.isHolding = this.unacknowledged > OUTPUT_HIGH_WATER;
  };

  /**
   * Records processed output and resumes once the browser caught up.
   *
   * @param characters - Output characters processed since the last report.
   */
  public acknowledge(characters: number): void {
    this.unacknowledged = Math.max(0, this.unacknowledged - characters);
    if (!this.isHolding || this.unacknowledged >= OUTPUT_LOW_WATER) return;
    this.isHolding = false;
    this.session.replay(this.sent, this.deliver);
    // State events may have left the history while output was held.
    this.deliver({
      kind: "state",
      sequence: this.sent,
      state: this.session.view(),
    });
  }
}

/**
 * Follows one console over an open channel.
 *
 * @remarks
 * Input and geometry changes keep the order they were typed in and are
 * written only while ownership and rights were confirmed within the last two
 * seconds; while someone types, the check is renewed in the background.
 * Acknowledgements only release held output and are applied at once. Closing the channel leaves the shell running for
 * its lease, so the browser can attach again; inputs are never replayed.
 */
function attach(
  channel: WebSocket,
  admission: ChannelAdmission,
  active: Map<string, WebSocket>,
): void {
  const { consoles, userId, scope, sessionId } = admission;
  const queue = new SerialQueue();
  let session = admission.session;
  let pending = 0;
  let isAlive = true;
  active.get(sessionId)?.close(CLOSE_SUPERSEDED, "Console opened elsewhere");
  active.set(sessionId, channel);
  const verify = async (): Promise<void> => {
    session = await consoles.require(userId, scope, sessionId);
  };
  const deny = (): void => channel.close(CLOSE_DENIED, "Console refused");
  const rights = new ChannelRights(verify, deny);
  const output = new ChannelOutput(channel, session, admission.after);
  const unfollow = session.follow(admission.after, output.deliver);
  const timer = setInterval(() => {
    if (!isAlive) channel.terminate();
    isAlive = false;
    channel.ping();
    void rights.renew().catch(deny);
  }, CHECK_MILLISECONDS);
  timer.unref();
  channel.on("pong", () => {
    isAlive = true;
  });
  channel.on("message", (raw, isBinary) => {
    try {
      const command = parseCommand(raw, isBinary);
      if (command.type === "ack") {
        output.acknowledge(command.characters);
        return;
      }
      if (pending >= MAXIMUM_PENDING_COMMANDS) throw new RangeError();
      pending += 1;
      void queue
        .run(async () => {
          await rights.require();
          if (command.type === "resize") session.resize(command);
          else session.write(command.data, command.attempt);
        })
        // A refused or outdated input is dropped; the state event explains why.
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
        });
    } catch {
      deny();
    }
  });
  channel.on("error", (error) => logCaughtError("RemoteConsoleChannel", error));
  channel.once("close", () => {
    clearInterval(timer);
    unfollow();
    if (active.get(sessionId) === channel) active.delete(sessionId);
  });
}

/**
 * Serves the persistent console channel next to the console routes.
 *
 * @param server - The Pages HTTP server.
 * @param trustedProxies - Proxies whose `X-Forwarded-Proto` is believed;
 * empty by default.
 *
 * @remarks
 * Upgrades of other paths are left to their own handlers.
 */
export function installRemoteConsoleChannel(
  server: Server,
  trustedProxies: readonly string[] = [],
): void {
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: MAXIMUM_PAYLOAD,
    perMessageDeflate: false,
  });
  const active = new Map<string, WebSocket>();
  const isForwardedHttps = createForwardedHttpsCheck(trustedProxies);
  server.on("upgrade", (request, socket, head) => {
    if (!isRemoteConsoleChannel(request.url)) return;
    const deadline = setTimeout(() => socket.destroy(), UPGRADE_DEADLINE);
    void (async () => {
      try {
        if (websocket.clients.size >= MAXIMUM_CHANNELS)
          throw new RemoteError("remote_blocked");
        const admission = await admit(request, isForwardedHttps);
        websocket.handleUpgrade(request, socket, head, (channel) =>
          attach(channel, admission, active),
        );
      } catch (error: unknown) {
        rejectUpgrade(socket, error);
      } finally {
        clearTimeout(deadline);
      }
    })();
  });
  registerShutdownTask(() => {
    for (const channel of websocket.clients) channel.terminate();
    websocket.close();
    return Promise.resolve();
  });
}
