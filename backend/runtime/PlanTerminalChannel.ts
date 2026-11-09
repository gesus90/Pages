import { WebSocketServer } from "ws";
import { z } from "zod";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import {
  readSessionCursor,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { terminalCommandSchema } from "@/definition/AgentTerminal";

import { isPlanTerminalChannel, planTerminalOf } from "./ChannelPaths";
import { createForwardedHttpsCheck } from "./ForwardedProtocol";
import { registerShutdownTask } from "./ProcessLifecycle";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import type {
  AgentTerminalInputTarget,
  AgentTerminalService,
} from "@/backend/service/agents/terminal/AgentTerminalService";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type {
  AgentTerminalCommand,
  AgentTerminalEvent,
} from "@/definition/AgentTerminal";

const MAXIMUM_CHANNELS = 200;
const MAXIMUM_PAYLOAD = 64 * 1024;
/** A viewer that stops reading is disconnected and reconnects from its cursor. */
const MAXIMUM_BUFFERED = 2 * 1024 * 1024;
const MAXIMUM_PENDING_COMMANDS = 64;
/** Input within this time of a successful rights check is queued at once. */
const RIGHTS_VALIDITY = 2_000;
/** While someone types, the check is renewed in the background after this time. */
const RIGHTS_REFRESH = 1_000;
const CHECK_MILLISECONDS = 15_000;
const UPGRADE_DEADLINE = 10_000;
const CLOSE_DENIED = 4003;
const CLOSE_OVERFLOW = 4008;

/** What an accepted upgrade has proven: the person, the terminal and the cursor. */
interface ChannelAdmission {
  readonly userId: string;
  readonly key: AgentSessionKey;
  readonly after: number;
  readonly terminals: AgentTerminalService;
}

function rejectUpgrade(socket: Duplex, error: unknown): void {
  const status =
    error instanceof AgentError && error.code === "plan_terminal_unavailable"
      ? 404
      : 403;
  socket.end(
    `HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Checks origin, sign-in and read access before a channel opens.
 *
 * @remarks
 * Only the browser's own Pages origin may open a channel, so a foreign page
 * cannot use the session cookie.
 */
async function admit(
  request: IncomingMessage,
  isForwardedHttps: (request: IncomingMessage) => boolean,
): Promise<ChannelAdmission> {
  const url = new URL(request.url ?? "/", "http://pages.invalid");
  const target = planTerminalOf(url.pathname);
  const host = request.headers.host;
  const origin = `${isForwardedHttps(request) ? "https" : "http"}://${host}`;
  if (!target || !host || request.headers.origin !== origin)
    throw new AgentError("plan_access_denied");
  const key = readSessionKey(target, url.searchParams);
  const after = readSessionCursor(url.searchParams.get("after"));
  const user = await getAuthenticatedUser(
    new Request(origin, { headers: { Cookie: request.headers.cookie ?? "" } }),
  );
  if (!user || user.mustChangePassword)
    throw new AgentError("plan_access_denied");
  const terminals = (await getApplicationServices()).agentTerminalService;
  await terminals.canInput(user.id, key);
  return { userId: user.id, key, after, terminals };
}

/** The input rights of one channel, never trusted for longer than {@link RIGHTS_VALIDITY}. */
class InputRights {
  private readonly check: () => Promise<AgentTerminalInputTarget>;
  private target: AgentTerminalInputTarget | null = null;
  private verifiedAt = 0;
  private renewal: Promise<AgentTerminalInputTarget> | null = null;

  public constructor(check: () => Promise<AgentTerminalInputTarget>) {
    this.check = check;
  }

  /** The target of the inputs once the rights are known to hold; rejects without them. */
  public async require(): Promise<AgentTerminalInputTarget> {
    const age = Date.now() - this.verifiedAt;
    if (this.target && age <= RIGHTS_VALIDITY) {
      if (age > RIGHTS_REFRESH) void this.renew().catch(() => undefined);
      return this.target;
    }
    return this.renew();
  }

  private renew(): Promise<AgentTerminalInputTarget> {
    this.renewal ??= this.check()
      .then((target) => {
        this.target = target;
        this.verifiedAt = Date.now();
        return target;
      })
      .catch((error: unknown) => {
        this.target = null;
        throw error;
      })
      .finally(() => {
        this.renewal = null;
      });
    return this.renewal;
  }
}

function parseCommand(raw: RawData, isBinary: boolean): AgentTerminalCommand {
  if (isBinary || !(raw instanceof Buffer))
    throw new AgentError("plan_invalid");
  return terminalCommandSchema.parse(JSON.parse(raw.toString("utf8")));
}

function deliver(channel: WebSocket, event: AgentTerminalEvent): void {
  if (channel.readyState !== channel.OPEN) return;
  if (channel.bufferedAmount > MAXIMUM_BUFFERED) {
    channel.close(CLOSE_OVERFLOW, "Terminal output overflow");
    return;
  }
  channel.send(JSON.stringify(event));
}

/**
 * Follows one terminal over an open channel and passes checked input on.
 *
 * @remarks
 * Every input is checked on the server: the right to run the plan, a running
 * run and a running CLI, confirmed within the last two seconds. Inputs keep
 * the order they were typed in; a refused one is dropped and the state
 * event tells the viewer why. Closing the channel leaves the CLI and the run
 * alone; the viewer attaches again from its cursor.
 */
function attach(channel: WebSocket, admission: ChannelAdmission): void {
  const { terminals, userId, key } = admission;
  const queue = new SerialQueue();
  const rights = new InputRights(() => terminals.inputTarget(userId, key));
  let pending = 0;
  let isAlive = true;
  let stop: (() => void) | null = null;
  let isClosed = false;
  const deny = (): void => channel.close(CLOSE_DENIED, "Terminal refused");
  void terminals
    .follow(userId, key, admission.after, (event) => deliver(channel, event))
    .then((unfollow) => {
      if (isClosed) unfollow();
      else stop = unfollow;
    })
    .catch(deny);
  const timer = setInterval(() => {
    if (!isAlive) channel.terminate();
    isAlive = false;
    channel.ping();
  }, CHECK_MILLISECONDS);
  timer.unref();
  channel.on("pong", () => {
    isAlive = true;
  });
  channel.on("message", (raw, isBinary) => {
    let command: AgentTerminalCommand;
    try {
      command = parseCommand(raw, isBinary);
    } catch {
      deny();
      return;
    }
    if (pending >= MAXIMUM_PENDING_COMMANDS) {
      deny();
      return;
    }
    pending += 1;
    void queue
      .run(async () => terminals.deliver(await rights.require(), command))
      .catch((error: unknown) => logCaughtError("PlanTerminalChannel", error))
      .finally(() => {
        pending -= 1;
      });
  });
  channel.on("error", (error) => logCaughtError("PlanTerminalChannel", error));
  channel.once("close", () => {
    isClosed = true;
    clearInterval(timer);
    stop?.();
  });
}

/**
 * Serves the terminal channel of plan nodes next to their session routes.
 *
 * @param server - The Pages HTTP server.
 * @param trustedProxies - Proxies whose `X-Forwarded-Proto` is believed.
 */
export function installPlanTerminalChannel(
  server: Server,
  trustedProxies: readonly string[] = [],
): void {
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: MAXIMUM_PAYLOAD,
    perMessageDeflate: false,
  });
  const isForwardedHttps = createForwardedHttpsCheck(trustedProxies);
  server.on("upgrade", (request, socket, head) => {
    if (!isPlanTerminalChannel(request.url)) return;
    const deadline = setTimeout(() => socket.destroy(), UPGRADE_DEADLINE);
    void (async () => {
      try {
        if (websocket.clients.size >= MAXIMUM_CHANNELS)
          throw new AgentError("plan_access_denied");
        const admission = await admit(request, isForwardedHttps);
        websocket.handleUpgrade(request, socket, head, (channel) =>
          attach(channel, admission),
        );
      } catch (error: unknown) {
        if (!(error instanceof AgentError || error instanceof z.ZodError))
          logCaughtError("PlanTerminalChannel", error);
        rejectUpgrade(socket, error);
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
    { step: "plan_terminal_channel" },
  );
}
