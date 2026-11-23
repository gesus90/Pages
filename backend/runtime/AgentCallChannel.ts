import { WebSocketServer } from "ws";
import { z } from "zod";

import { getApplicationServices } from "@/app/lib/services.server";
import { logCaughtError } from "@/backend/logging/Logger";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import {
  AGENT_CALL_AUDIO_HEADER_BYTES,
  AGENT_CALL_SOCKET_PATH,
} from "@/definition/AgentCall";

import { admitConversationWebChannel } from "./ConversationWebChannel";
import { createForwardedHttpsCheck } from "./ForwardedProtocol";
import { registerShutdownTask } from "./ProcessLifecycle";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import type { AgentCallLiveHandle } from "@/backend/service/employee/call/AgentCallLive";
import type {
  AgentCallLiveCommand,
  AgentCallLiveEvent,
} from "@/definition/AgentCall";
import type { User } from "@/definition/User";

const COMPONENT = "AgentCallChannel";
const MAXIMUM_CHANNELS = 200;
const UPGRADE_DEADLINE_MS = 10_000;

/** The largest frame: a block of audio is a few kilobytes, a command far less. */
const MAXIMUM_FRAME_BYTES = 64 * 1024;

/** How long a new connection may take to name its call. */
const HELLO_DEADLINE_MS = 5_000;

/** How often the connection is probed and the session checked again. */
const HEARTBEAT_MS = 20_000;

/** Above this many unsent bytes the connection is too slow for a call and is closed. */
const MAXIMUM_BUFFERED_BYTES = 4 * 1024 * 1024;

const IDENTIFIER = /^[a-zA-Z0-9-]{1,60}$/u;

const turnSchema = z.number().int().min(1).max(1_000_000);
const countSchema = z.number().int().min(0).max(1_000_000);

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    agentId: z.string().regex(IDENTIFIER),
    callId: z.string().regex(IDENTIFIER),
  }),
  z.object({ type: z.literal("speech"), turn: turnSchema }),
  z.object({ type: z.literal("quiet"), turn: turnSchema, blocks: countSchema }),
  z.object({
    type: z.literal("end"),
    turn: turnSchema,
    blocks: countSchema,
    voicedBlocks: countSchema,
  }),
  z.object({ type: z.literal("cancel"), turn: turnSchema }),
  z.object({ type: z.literal("played"), turn: turnSchema, index: countSchema }),
  z.object({
    type: z.literal("spoken"),
    turn: turnSchema,
    spokenCharacters: countSchema,
  }),
  z.object({ type: z.literal("hangup") }),
]);

/** Raised when an upgrade is refused; the status goes to the browser. */
class ChannelRefusal extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(`The agent call channel was refused with ${status}.`);
    this.name = "ChannelRefusal";
    this.status = status;
  }
}

function refuseUpgrade(socket: Duplex, error: unknown): void {
  const status =
    error instanceof ChannelRefusal || hasStatus(error) ? error.status : 503;
  socket.end(
    `HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function hasStatus(error: unknown): error is { readonly status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  );
}

function isAgentCallChannel(url: string | undefined): boolean {
  if (!URL.canParse(url ?? "/", "http://pages.invalid")) return false;
  return (
    new URL(url ?? "/", "http://pages.invalid").pathname ===
    AGENT_CALL_SOCKET_PATH
  );
}

function bytesOf(frame: RawData): Buffer {
  if (Array.isArray(frame)) return Buffer.concat(frame);
  return frame instanceof ArrayBuffer ? Buffer.from(frame) : frame;
}

function parseCommand(frame: RawData): AgentCallLiveCommand | null {
  try {
    const parsed = commandSchema.safeParse(
      JSON.parse(bytesOf(frame).toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Hands one command to the call. */
async function dispatch(
  handle: AgentCallLiveHandle,
  command: AgentCallLiveCommand,
): Promise<void> {
  const { call } = handle;
  if (command.type === "speech") call.speech(command.turn);
  if (command.type === "quiet") call.pause(command.turn, command.blocks);
  if (command.type === "cancel") call.cancel(command.turn);
  if (command.type === "played") call.played(command.turn, command.index);
  if (command.type === "spoken")
    await call.spoken(command.turn, command.spokenCharacters);
  if (command.type === "end")
    await call.end(command.turn, {
      total: command.blocks,
      voiced: command.voicedBlocks,
    });
  if (command.type === "hangup") await handle.hangup();
}

/** Hands one block of audio to the call: turn, sequence and the samples. */
function dispatchAudio(handle: AgentCallLiveHandle, frame: Buffer): void {
  if (frame.length <= AGENT_CALL_AUDIO_HEADER_BYTES) return;
  const samples = frame.subarray(AGENT_CALL_AUDIO_HEADER_BYTES);
  if (samples.length % 2 !== 0) return;
  handle.call.audio(frame.readUInt32LE(0), frame.readUInt32LE(4), samples);
}

/** One connection of a browser to its call. */
class AgentCallConnection {
  private readonly channel: WebSocket;
  private readonly person: User;
  private readonly isSessionActive: () => Promise<boolean>;
  private handle: AgentCallLiveHandle | null = null;
  private isAlive = true;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly helloDeadline: ReturnType<typeof setTimeout>;
  /** What arrived while the call is being opened; `null` before `hello` and once it is open. */
  private backlog: (AgentCallLiveCommand | Buffer)[] | null = null;
  private isStopped = false;

  public constructor(
    channel: WebSocket,
    person: User,
    isSessionActive: () => Promise<boolean>,
  ) {
    this.channel = channel;
    this.person = person;
    this.isSessionActive = isSessionActive;
    this.helloDeadline = setTimeout(
      () => this.channel.close(1008, "hello"),
      HELLO_DEADLINE_MS,
    );
    this.heartbeat = setInterval(() => void this.probe(), HEARTBEAT_MS);
    channel.on("message", (frame, isBinary) => this.receive(frame, isBinary));
    channel.on("pong", () => {
      this.isAlive = true;
    });
    channel.on("error", (error) => logCaughtError(COMPONENT, error));
    channel.once("close", () => this.stop());
  }

  // Frames are handled in the order they arrive, so a block never overtakes the start of its utterance.
  private receive(frame: RawData, isBinary: boolean): void {
    const item = isBinary ? bytesOf(frame) : parseCommand(frame);
    if (item === null) return;
    if (!Buffer.isBuffer(item) && item.type === "hello") {
      void this.open(item);
      return;
    }
    if (this.backlog !== null) this.backlog.push(item);
    else this.process(item);
  }

  // Each command starts at once; an end runs the whole answer, so nothing waits for it.
  private process(item: AgentCallLiveCommand | Buffer): void {
    const handle = this.handle;
    if (handle === null) return;
    if (Buffer.isBuffer(item)) return dispatchAudio(handle, item);
    void dispatch(handle, item)
      .then(() => {
        if (item.type === "hangup") this.channel.close(1000, "hangup");
      })
      .catch((error: unknown) => logCaughtError(COMPONENT, error));
  }

  private async open(
    command: Extract<AgentCallLiveCommand, { type: "hello" }>,
  ): Promise<void> {
    if (this.handle !== null || this.backlog !== null) return;
    clearTimeout(this.helloDeadline);
    const backlog: (AgentCallLiveCommand | Buffer)[] = [];
    this.backlog = backlog;
    try {
      const { agentCallService } = await getApplicationServices();
      this.handle = await agentCallService.openLive(
        this.person,
        { agentId: command.agentId, callId: command.callId },
        (event) => this.send(event),
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      this.backlog = null;
      this.send({ type: "closed", code: "agent_unavailable" });
      this.channel.close(1011, "unavailable");
      return;
    }
    // A connection that closed while the call opened lets the call go at once.
    if (this.isStopped) return this.stop();
    this.backlog = null;
    for (const item of backlog) this.process(item);
  }

  private send(event: AgentCallLiveEvent): void {
    if (this.channel.readyState !== this.channel.OPEN) return;
    if (this.channel.bufferedAmount > MAXIMUM_BUFFERED_BYTES) {
      this.channel.terminate();
      return;
    }
    this.channel.send(JSON.stringify(event));
  }

  private async probe(): Promise<void> {
    if (!this.isAlive) {
      this.channel.terminate();
      return;
    }
    this.isAlive = false;
    this.channel.ping();
    try {
      if (!(await this.isSessionActive())) this.channel.close(1008, "session");
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  private stop(): void {
    this.isStopped = true;
    clearTimeout(this.helloDeadline);
    clearInterval(this.heartbeat);
    this.handle?.release();
    this.handle = null;
  }
}

async function admit(
  request: IncomingMessage,
  context: Parameters<typeof admitConversationWebChannel>[1],
): Promise<{ readonly person: User; readonly sessionToken: string }> {
  const admission = await admitConversationWebChannel(request, context);
  const { authService } = await getApplicationServices();
  const person = await authService.getAuthenticatedUser(admission.sessionToken);
  if (person === null || person.mustChangePassword)
    throw new ChannelRefusal(401);
  return { person, sessionToken: admission.sessionToken };
}

/**
 * Serves the live path of the agent calls of the chat page on the Pages port.
 * @param server - The Pages HTTP server.
 * @param trustedProxies - Proxies whose `X-Forwarded-Proto` is believed.
 * @remarks
 * Only the browser's own Pages origin with a session that holds may open the
 * channel, and the session is checked again while the call runs. The
 * browser names its call with `hello`; then small binary blocks of audio and
 * JSON commands flow in, JSON events flow out. Upgrades of other paths are
 * left to their own handlers.
 */
export function installAgentCallChannel(
  server: Server,
  trustedProxies: readonly string[] = [],
): void {
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: MAXIMUM_FRAME_BYTES,
    perMessageDeflate: false,
  });
  const isForwardedHttps = createForwardedHttpsCheck(trustedProxies);
  const authenticator = new PagesPicaMobileAuthenticator(
    async () => (await getApplicationServices()).authService,
  );
  server.on("upgrade", (request, socket, head) => {
    if (!isAgentCallChannel(request.url)) return;
    socket.on("error", () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), UPGRADE_DEADLINE_MS);
    void (async () => {
      try {
        if (websocket.clients.size >= MAXIMUM_CHANNELS)
          throw new ChannelRefusal(503);
        const { person, sessionToken } = await admit(request, {
          isForwardedHttps,
          authenticator,
        });
        websocket.handleUpgrade(request, socket, head, (channel) => {
          new AgentCallConnection(channel, person, () =>
            authenticator.isSessionActive(sessionToken),
          );
        });
      } catch (error: unknown) {
        if (!(error instanceof ChannelRefusal) && !hasStatus(error))
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
    { step: "agent_call_channel" },
  );
}
