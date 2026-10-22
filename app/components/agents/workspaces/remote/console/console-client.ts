import { z } from "zod";

import {
  CONSOLE_MAXIMUM_RETRIES,
  consoleEventSchema,
} from "@/definition/RemoteConsole";

import type { Terminal } from "@xterm/xterm";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/** Before the server reports, a console is connecting and knows no directory. */
export const INITIAL_CONSOLE_STATE: RemoteConsoleState = {
  status: "connecting",
  attempts: 0,
  message: null,
  exitCode: null,
  directory: null,
};

const openedSchema = z.object({ sessionId: z.uuid() });
const errorSchema = z.object({
  message: z.string().regex(/^remote\.(?:error|failure|console)\.[a-zA-Z_]+$/u),
});

/** Browser transport for one console; output streams, input stays ordered and is never retried. */
export class RemoteConsoleClient {
  private readonly url: string;
  private readonly terminal: Terminal;
  private readonly onState: (state: RemoteConsoleState) => void;
  private readonly lifetime = new AbortController();
  private sessionId: string | null = null;
  private events: EventSource | null = null;
  private sequence = 0;
  private streamAttempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inputBuffer = "";
  private isSendingInput = false;
  private state: RemoteConsoleState = INITIAL_CONSOLE_STATE;

  public constructor(input: {
    /** Same-origin route of a workspace or connection console. */
    readonly endpoint: string;
    readonly terminal: Terminal;
    readonly onState: RemoteConsoleClient["onState"];
  }) {
    this.url = input.endpoint;
    this.terminal = input.terminal;
    this.onState = input.onState;
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

  /** Batches pending keystrokes while preserving input order and a bounded buffer. */
  public input(input: string): void {
    if (this.state.status !== "connected" || !this.sessionId) return;
    if (this.inputBuffer.length + input.length > 64 * 1024) {
      this.fail(new Error("remote.console.inputOverflow"));
      return;
    }
    this.inputBuffer += input;
    if (!this.isSendingInput) void this.flushInput();
  }

  /** Forwards character geometry; the server stores it while reconnecting. */
  public resize(): void {
    if (
      !this.sessionId ||
      this.lifetime.signal.aborted ||
      this.state.status !== "connected"
    )
      return;
    void this.send({
      intent: "resize",
      sessionId: this.sessionId,
      columns: this.terminal.cols,
      rows: this.terminal.rows,
    }).catch((error: unknown) => {
      if (this.state.status === "connected") this.fail(error);
    });
  }

  /** Requests an explicit retry while retaining the server's attempt counter. */
  public reconnect(): void {
    if (this.streamAttempts >= CONSOLE_MAXIMUM_RETRIES) return;
    if (!this.sessionId) {
      void this.start();
      return;
    }
    this.events?.close();
    this.follow();
    if (this.state.status === "blocked")
      void this.send({ intent: "reconnect", sessionId: this.sessionId }).catch(
        (error: unknown) => this.fail(error),
      );
  }

  /** Releases the shell on panel disposal or page navigation. */
  public dispose(): void {
    this.lifetime.abort();
    this.events?.close();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.release();
  }

  private async flushInput(): Promise<void> {
    this.isSendingInput = true;
    const attempt = this.state.attempts;
    try {
      while (
        this.inputBuffer &&
        this.state.status === "connected" &&
        this.state.attempts === attempt
      ) {
        const chunk = this.inputBuffer.slice(0, 8192);
        this.inputBuffer = this.inputBuffer.slice(8192);
        await this.send({
          intent: "input",
          sessionId: this.sessionId,
          attempt,
          input: chunk,
        });
      }
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      // Pending input belongs to the old channel and must never reach a new shell.
      this.inputBuffer = "";
      this.isSendingInput = false;
    }
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
    const source = new EventSource(
      `${this.url}?sessionId=${this.sessionId}&after=${this.sequence}`,
    );
    this.events = source;
    source.onmessage = (message) => {
      try {
        const event = consoleEventSchema.parse(
          JSON.parse(String(message.data)),
        );
        if (event.kind === "output" && event.sequence > this.sequence)
          this.terminal.write(event.chunk);
        if (event.kind === "state") {
          if (event.state.status !== "connected") this.inputBuffer = "";
          this.state = event.state;
          this.terminal.options.disableStdin =
            event.state.status !== "connected";
          this.onState(event.state);
          if (event.state.status === "connected") this.resize();
          if (event.state.status === "ended") source.close();
        }
        this.sequence = Math.max(this.sequence, event.sequence);
      } catch {
        this.fail(new Error("remote.failure.remote_failed"));
        source.close();
      }
    };
    source.onerror = () => {
      source.close();
      this.retryStream();
    };
  }

  private retryStream(): void {
    this.inputBuffer = "";
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
    this.retryTimer = setTimeout(() => this.follow(), 3000);
  }

  private fail(error: unknown): void {
    this.inputBuffer = "";
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
