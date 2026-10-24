import { z } from "zod";

import {
  CONSOLE_INPUT_FRAGMENT,
  CONSOLE_MAXIMUM_RETRIES,
  consoleEventSchema,
} from "@/definition/RemoteConsole";

import type { Terminal } from "@xterm/xterm";
import type {
  RemoteConsoleCommand,
  RemoteConsoleEvent,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";

/** Before the server reports, a console is connecting and knows no directory. */
export const INITIAL_CONSOLE_STATE: RemoteConsoleState = {
  status: "connecting",
  attempts: 0,
  message: null,
  exitCode: null,
  directory: null,
  setup: null,
};

const openedSchema = z.object({ sessionId: z.uuid() });
const errorSchema = z.object({
  message: z.string().regex(/^remote\.(?:error|failure|console)\.[a-zA-Z_]+$/u),
});
/** Processed output is reported in steps of this size, or after a short quiet time. */
const ACK_CHARACTERS = 16 * 1024;
const ACK_QUIET_MILLISECONDS = 100;
/** Input beyond this is not typing any more; the channel refuses to hold it. */
const MAXIMUM_BUFFERED_INPUT = 256 * 1024;
const RETRY_MILLISECONDS = 3000;
/** The server replaced this channel with one of another tab, or refused it. */
const FINAL_CLOSE_CODES = new Set([4001, 4003]);

/** What the console reports beside the state: a part of the output that is lost. */
export interface ConsoleNotices {
  readonly onGap: () => void;
}

function channelUrl(
  endpoint: string,
  sessionId: string,
  after: number,
): string {
  const url = new URL(`${endpoint}/socket`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("after", String(after));
  return url.toString();
}

/**
 * Browser transport for one console: a persistent channel carries input,
 * geometry and output; nothing typed is ever queued or sent again.
 *
 * @remarks
 * Output is acknowledged only after xterm processed it, so the server holds
 * output while the terminal is behind. After a lost channel the client
 * attaches to the same shell again and continues after the last event it
 * received; a gap in the bounded history is reported, not hidden.
 */
export class RemoteConsoleClient {
  private readonly url: string;
  private readonly terminal: Terminal;
  private readonly onState: (state: RemoteConsoleState) => void;
  private readonly notices: ConsoleNotices;
  private readonly lifetime = new AbortController();
  private sessionId: string | null = null;
  private channel: WebSocket | null = null;
  private sequence = 0;
  private streamAttempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private processed = 0;
  private state: RemoteConsoleState = INITIAL_CONSOLE_STATE;

  public constructor(input: {
    /** Same-origin route of a workspace or connection console. */
    readonly endpoint: string;
    readonly terminal: Terminal;
    readonly onState: RemoteConsoleClient["onState"];
    readonly notices: ConsoleNotices;
  }) {
    this.url = input.endpoint;
    this.terminal = input.terminal;
    this.onState = input.onState;
    this.notices = input.notices;
  }

  /** Allocates the server session after xterm has measured the panel. */
  public async start(): Promise<void> {
    try {
      const response = await this.send({
        intent: "open",
        columns: this.terminal.cols,
        rows: this.terminal.rows,
      });
      this.sessionId = openedSchema.parse(response).sessionId;
      if (this.lifetime.signal.aborted) {
        this.release();
        return;
      }
      this.follow();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  /** Sends keystrokes and pastes at once, in order, bound to the current shell attempt. */
  public input(text: string): void {
    const channel = this.channel;
    if (this.state.status !== "connected" || channel?.readyState !== 1) return;
    if (channel.bufferedAmount + text.length > MAXIMUM_BUFFERED_INPUT) {
      this.fail(new Error("remote.console.inputOverflow"));
      return;
    }
    for (let offset = 0; offset < text.length; offset += CONSOLE_INPUT_FRAGMENT)
      this.command({
        type: "input",
        attempt: this.state.attempts,
        data: text.slice(offset, offset + CONSOLE_INPUT_FRAGMENT),
      });
  }

  /** Forwards character geometry; the server stores it while reconnecting. */
  public resize(): void {
    this.command({
      type: "resize",
      columns: this.terminal.cols,
      rows: this.terminal.rows,
    });
  }

  /** Requests an explicit retry while retaining the server's attempt counter. */
  public reconnect(): void {
    if (this.streamAttempts >= CONSOLE_MAXIMUM_RETRIES) return;
    if (!this.sessionId) {
      void this.start();
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.closeChannel();
    this.follow();
    if (this.state.status === "blocked")
      void this.send({ intent: "reconnect", sessionId: this.sessionId }).catch(
        (error: unknown) => this.fail(error),
      );
  }

  /** Releases the shell on panel disposal or page navigation. */
  public dispose(): void {
    this.lifetime.abort();
    this.closeChannel();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.release();
  }

  private command(command: RemoteConsoleCommand): void {
    if (this.channel?.readyState !== 1) return;
    this.channel.send(JSON.stringify(command));
  }

  private release(): void {
    if (!this.sessionId) return;
    const body = JSON.stringify({ intent: "close", sessionId: this.sessionId });
    this.sessionId = null;
    void fetch(this.url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => undefined);
  }

  private async send(command: object): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST",
      body: JSON.stringify(command),
      headers: { "Content-Type": "application/json" },
      signal: this.lifetime.signal,
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(result);
      throw new Error(
        parsed.success ? parsed.data.message : "remote.failure.remote_failed",
      );
    }
    return result;
  }

  private follow(): void {
    if (!this.sessionId || this.lifetime.signal.aborted) return;
    const channel = new WebSocket(
      channelUrl(this.url, this.sessionId, this.sequence),
    );
    this.channel = channel;
    channel.onmessage = (message) => {
      try {
        this.receive(
          consoleEventSchema.parse(JSON.parse(String(message.data))),
        );
      } catch {
        this.fail(new Error("remote.failure.remote_failed"));
        this.closeChannel();
      }
    };
    let hasOpened = false;
    channel.onopen = () => {
      hasOpened = true;
      this.streamAttempts = 0;
    };
    channel.onclose = (event) => {
      if (this.channel !== channel) return;
      this.channel = null;
      if (this.state.status === "ended") return;
      if (FINAL_CLOSE_CODES.has(event.code))
        this.fail(new Error("remote.console.streamBlocked"));
      else if (hasOpened) this.retryStream();
      else void this.probe();
    };
  }

  /**
   * A refused channel does not say why; the console route does. A shell
   * that no longer exists is reported as lost, so only a new session helps.
   */
  private async probe(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.send({ intent: "reconnect", sessionId: this.sessionId });
    } catch (error: unknown) {
      if (this.lifetime.signal.aborted) return;
      const message = error instanceof Error ? error.message : "";
      if (message === "remote.error.remote_workspace_not_found") {
        this.fail(new Error("remote.console.sessionLost"));
        return;
      }
      if (errorSchema.safeParse({ message }).success) {
        this.fail(error);
        return;
      }
    }
    this.retryStream();
  }

  private receive(event: RemoteConsoleEvent): void {
    if (event.kind === "output" && event.sequence > this.sequence)
      this.write(event.chunk);
    if (event.kind === "gap") this.notices.onGap();
    if (event.kind === "state") {
      this.state = event.state;
      this.terminal.options.disableStdin = event.state.status !== "connected";
      this.onState(event.state);
      if (event.state.status === "connected") this.resize();
    }
    this.sequence = Math.max(this.sequence, event.sequence);
  }

  /** The xterm flow-control pattern: acknowledge what the parser has processed. */
  private write(chunk: string): void {
    this.terminal.write(chunk, () => {
      this.processed += chunk.length;
      if (this.processed >= ACK_CHARACTERS) this.acknowledge();
      else
        this.ackTimer ??= setTimeout(
          () => this.acknowledge(),
          ACK_QUIET_MILLISECONDS,
        );
    });
  }

  private acknowledge(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (this.processed === 0) return;
    this.command({ type: "ack", characters: this.processed });
    this.processed = 0;
  }

  private closeChannel(): void {
    const channel = this.channel;
    this.channel = null;
    channel?.close();
  }

  private retryStream(): void {
    // Output processed for the old channel is replayed and counted anew.
    this.processed = 0;
    if (this.lifetime.signal.aborted || this.state.status === "ended") return;
    if (this.streamAttempts >= CONSOLE_MAXIMUM_RETRIES) {
      this.state = { ...this.state, attempts: CONSOLE_MAXIMUM_RETRIES };
      this.fail(new Error("remote.console.streamBlocked"));
      return;
    }
    this.streamAttempts += 1;
    this.terminal.options.disableStdin = true;
    this.state = {
      ...this.state,
      status: "reconnecting",
      attempts: this.streamAttempts,
      message: "remote.console.streamLost",
    };
    this.onState(this.state);
    this.retryTimer = setTimeout(() => this.follow(), RETRY_MILLISECONDS);
  }

  private fail(error: unknown): void {
    if (this.lifetime.signal.aborted) return;
    const parsed = errorSchema.safeParse({
      message: error instanceof Error ? error.message : "",
    });
    this.terminal.options.disableStdin = true;
    this.state = {
      ...this.state,
      status: "blocked",
      message: parsed.success
        ? parsed.data.message
        : "remote.failure.remote_failed",
    };
    this.onState(this.state);
  }
}
