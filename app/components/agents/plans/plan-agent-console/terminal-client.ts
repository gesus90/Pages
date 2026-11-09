import { TERMINAL_INPUT_FRAGMENT } from "@/definition/AgentTerminal";

import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type {
  AgentTerminalCommand,
  AgentTerminalEvent,
  AgentTerminalOpening,
  AgentTerminalPage,
} from "@/definition/AgentTerminal";

/** A dropped channel is opened again after this pause. */
const RETRY_MILLISECONDS = 3_000;
const CLOSE_DENIED = 4003;

/**
 * Answers a terminal sends to a query of the program, such as its colors,
 * its cursor position or its abilities.
 *
 * @remarks
 * The terminal of the server answers every query of the CLI already. A
 * browser that replays the output would answer them again and send the
 * answers as typed input, so the viewer never passes them on.
 */
const TERMINAL_ANSWER =
  /^(?:\u001b\[\??[\d;]*c|\u001b\[>[\d;]*c|\u001b\[\d+;\d+R|\u001b\][\d]+;[^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001bP[\s\S]*\u001b\\|\u001b\[\?[\d;]*\$y)$/u;

/**
 * Whether data from the browser terminal is an automatic answer to a query.
 *
 * @param input - What xterm reported as input.
 */
export function isTerminalAnswer(input: string): boolean {
  return TERMINAL_ANSWER.test(input);
}

/** The read and command route of a terminal, with plan and attempt in the query. */
export function terminalAddress(key: AgentSessionKey, query = ""): string {
  const search = new URLSearchParams({
    planId: key.planId,
    attemptId: key.attemptId,
  });
  return `/agent-api/plan-runs/${encodeURIComponent(key.runId)}/steps/${encodeURIComponent(key.stepId)}/terminal?${search.toString()}${query}`;
}

function channelAddress(key: AgentSessionKey, after: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const search = new URLSearchParams({
    planId: key.planId,
    attemptId: key.attemptId,
    after: String(after),
  });
  return `${protocol}//${window.location.host}/agent-api/plan-runs/${encodeURIComponent(key.runId)}/steps/${encodeURIComponent(key.stepId)}/terminal/socket?${search.toString()}`;
}

async function readBody(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? Object.fromEntries(Object.entries(body))
      : null;
  } catch {
    return null;
  }
}

function failure(body: Record<string, unknown> | null): string {
  const error = body?.error;
  return typeof error === "string" ? error : "general";
}

/** The outcome of a read or a command: its value or a translatable error. */
export type TerminalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * Reads what a viewer gets when it opens the terminal.
 *
 * @param key - The node attempt.
 * @param signal - Aborts the read when the console closes.
 */
export async function readTerminalOpening(
  key: AgentSessionKey,
  signal: AbortSignal,
): Promise<TerminalResult<AgentTerminalOpening>> {
  try {
    const response = await fetch(terminalAddress(key), {
      headers: { Accept: "application/json" },
      signal,
    });
    const body = await readBody(response);
    if (!response.ok || !body?.opening)
      return { ok: false, error: failure(body) };
    // The route answers with this contract; it is the console's own backend.
    return { ok: true, value: body.opening as AgentTerminalOpening };
  } catch {
    return { ok: false, error: signal.aborted ? "cancelled" : "offline" };
  }
}

/** Reads one page of older segments before the first one the viewer has. */
export async function readTerminalPage(
  key: AgentSessionKey,
  before: number,
): Promise<TerminalResult<AgentTerminalPage>> {
  try {
    const response = await fetch(terminalAddress(key, `&before=${before}`), {
      headers: { Accept: "application/json" },
    });
    const body = await readBody(response);
    if (!response.ok || !body?.page) return { ok: false, error: failure(body) };
    return { ok: true, value: body.page as AgentTerminalPage };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/**
 * Sends the multi-line input as one paste, or interrupts the current step.
 *
 * @returns Success only once the server checked the right and queued it.
 */
export async function postTerminalCommand(
  key: AgentSessionKey,
  fields:
    | { readonly intent: "paste"; readonly text: string }
    | { readonly intent: "interrupt" },
): Promise<TerminalResult<null>> {
  const form = new FormData();
  for (const [name, entry] of Object.entries(fields)) form.set(name, entry);
  try {
    const response = await fetch(terminalAddress(key), {
      method: "POST",
      body: form,
    });
    const body = await readBody(response);
    return response.ok
      ? { ok: true, value: null }
      : { ok: false, error: failure(body) };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/** What the channel of a terminal reports. */
export interface TerminalChannelHandlers {
  readonly onEvent: (event: AgentTerminalEvent) => void;
  readonly onConnection: (state: "live" | "reconnecting" | "closed") => void;
}

/**
 * The live channel of one terminal: segments after a cursor and the input
 * of the viewer.
 *
 * @remarks
 * A dropped channel opens again from the last segment the viewer has, so a
 * reconnect neither repeats nor misses output. Closing the channel leaves
 * the CLI and the run alone.
 */
export class TerminalChannel {
  private readonly key: AgentSessionKey;
  private readonly handlers: TerminalChannelHandlers;
  private socket: WebSocket | null = null;
  private cursor: number;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;
  private isEnded = false;

  public constructor(
    key: AgentSessionKey,
    after: number,
    handlers: TerminalChannelHandlers,
  ) {
    this.key = key;
    this.cursor = after;
    this.handlers = handlers;
    this.open();
  }

  /** The last segment the viewer has. */
  public get position(): number {
    return this.cursor;
  }

  /** Marks the terminal as ended: a dropped channel then stays closed. */
  public end(): void {
    this.isEnded = true;
  }

  /**
   * Sends typed keys in fragments; the server checks every one.
   *
   * @returns Whether the channel was open.
   */
  public input(keys: string): boolean {
    for (let start = 0; start < keys.length; start += TERMINAL_INPUT_FRAGMENT)
      if (
        !this.send({
          type: "input",
          data: keys.slice(start, start + TERMINAL_INPUT_FRAGMENT),
        })
      )
        return false;
    return true;
  }

  /** Asks the server to give the pseudo terminal the geometry of this viewer. */
  public resize(columns: number, rows: number): void {
    this.send({ type: "resize", columns, rows });
  }

  /** Closes the channel for good. */
  public dispose(): void {
    this.isDisposed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.socket?.close(1000, "Console closed");
    this.socket = null;
  }

  private send(command: AgentTerminalCommand): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }

  private open(): void {
    const socket = new WebSocket(channelAddress(this.key, this.cursor));
    this.socket = socket;
    socket.onopen = () => this.handlers.onConnection("live");
    socket.onmessage = (message) => this.receive(message.data);
    socket.onclose = (event) => {
      if (this.socket !== socket || this.isDisposed) return;
      this.socket = null;
      if (event.code === CLOSE_DENIED || this.isEnded) {
        this.handlers.onConnection("closed");
        return;
      }
      this.handlers.onConnection("reconnecting");
      this.retry = setTimeout(() => this.open(), RETRY_MILLISECONDS);
    };
  }

  private receive(message: unknown): void {
    if (typeof message !== "string") return;
    let event: AgentTerminalEvent;
    try {
      // The channel is the console's own backend and sends this contract only.
      event = JSON.parse(message) as AgentTerminalEvent;
    } catch {
      return;
    }
    if (event.kind === "output") {
      if (event.sequence <= this.cursor) return;
      this.cursor = event.sequence;
    }
    if (event.kind === "gap") this.cursor = event.sequence;
    this.handlers.onEvent(event);
  }
}
