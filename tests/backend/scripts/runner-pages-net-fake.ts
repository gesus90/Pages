import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";

import { vi } from "vitest";

/** One request the runner sent over the private socket. */
export interface PagesEnvelope {
  readonly jobId: string;
  readonly request: Readonly<Record<string, unknown>>;
}

/** What the fake Pages transport answers: raw chunks, or nothing at all. */
export type PagesAnswer = readonly string[] | "silence";

/** Answers one request of the runner. */
export type PagesHandler = (
  envelope: PagesEnvelope,
) => Promise<PagesAnswer> | PagesAnswer;

/** A socket that records what it was given and lets a test drive its events. */
export class FakeSocket extends EventEmitter {
  public timeoutMs = 0;
  public onTimeout: (() => void) | undefined;
  public destroyed = false;
  public written = "";
  public ended = false;

  /** Records the timeout like `net.Socket` and keeps its callback. */
  public setTimeout(milliseconds: number, callback: () => void): this {
    this.timeoutMs = milliseconds;
    this.onTimeout = callback;
    return this;
  }

  /** Marks the socket as destroyed and reports the reason as an error. */
  public destroy(error?: Error): this {
    this.destroyed = true;
    if (error) this.emit("error", error);
    return this;
  }

  /** Keeps what the runner wrote; a client socket then gets its answer. */
  public end(payload?: string): this {
    this.ended = true;
    this.written = payload ?? "";
    if (fakeNet.clientSockets.includes(this)) void fakeNet.answer(this);
    return this;
  }
}

/** The relay server the runner opens on its socket path. */
export class FakeServer extends EventEmitter {
  public socketPath = "";
  public closed = false;

  public readonly connectionListener: (socket: FakeSocket) => void;

  public constructor(connectionListener: (socket: FakeSocket) => void) {
    super();
    this.connectionListener = connectionListener;
  }

  /** Creates the socket file like a listening server would. */
  public listen(socketPath: string, callback: () => void): this {
    this.socketPath = socketPath;
    if (fakeNet.listenError) {
      queueMicrotask(() => this.emit("error", fakeNet.listenError));
      return this;
    }
    writeFileSync(socketPath, "");
    queueMicrotask(callback);
    return this;
  }

  /** Remembers that the runner stopped the server. */
  public close(): this {
    this.closed = true;
    return this;
  }
}

const silent: PagesHandler = () => "silence";

/** Shared state of the fake `node:net` module. */
export const fakeNet = {
  clientSockets: [] as FakeSocket[],
  servers: [] as FakeServer[],
  connectedPaths: [] as string[],
  connectError: false,
  listenError: undefined as Error | undefined,
  handler: silent,
  reset(): void {
    this.clientSockets = [];
    this.servers = [];
    this.connectedPaths = [];
    this.connectError = false;
    this.listenError = undefined;
    this.handler = silent;
  },
  /** Sends the answer of the handler as data chunks, then ends the stream. */
  async answer(socket: FakeSocket): Promise<void> {
    const envelope = JSON.parse(socket.written) as PagesEnvelope;
    const answer = await this.handler(envelope);
    if (answer === "silence") return;
    for (const chunk of answer) {
      if (socket.destroyed) return;
      socket.emit("data", Buffer.from(chunk));
    }
    if (!socket.destroyed) socket.emit("end");
  },
};

/** An accepted reply of the Pages transport. */
export function okReply(result: unknown): readonly string[] {
  return [JSON.stringify({ ok: true, result })];
}

/** A refused reply of the Pages transport. */
export function refusedReply(
  body: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [JSON.stringify({ ok: false, ...body })];
}

type ServerArguments = [unknown, (socket: FakeSocket) => void];

/** Module factory for `vi.mock("node:net", ...)`. */
export function netModule(): {
  createConnection: (socketPath: string) => FakeSocket;
  createServer: (...serverArguments: ServerArguments) => FakeServer;
} {
  return {
    createConnection: vi.fn((socketPath: string) => {
      const socket = new FakeSocket();
      fakeNet.clientSockets.push(socket);
      fakeNet.connectedPaths.push(socketPath);
      queueMicrotask(() =>
        socket.emit(fakeNet.connectError ? "error" : "connect"),
      );
      return socket;
    }),
    createServer: vi.fn((...[, listener]: ServerArguments) => {
      const server = new FakeServer(listener);
      fakeNet.servers.push(server);
      return server;
    }),
  };
}
