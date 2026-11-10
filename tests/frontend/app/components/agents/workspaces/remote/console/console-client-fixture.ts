import { vi } from "vitest";

import {
  INITIAL_CONSOLE_STATE,
  RemoteConsoleClient,
} from "@/app/components/agents/workspaces/remote/console/console-client";

import type { Mock } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type {
  RemoteConsoleEvent,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";

/** A valid session id. */
export const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
/** Same-origin route of the console. */
export const ENDPOINT = "/agents/workspaces/remote/console";

/** A channel that records what the client sends and lets a test play the server. */
export class FakeWebSocket {
  public static readonly instances: FakeWebSocket[] = [];
  public readyState = 0;
  public bufferedAmount = 0;
  public readonly sent: string[] = [];
  public readonly url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((message: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number }) => void) | null = null;
  public readonly close = vi.fn(() => {
    this.readyState = 3;
  });

  /** Registers the channel the way the browser opens it. */
  public constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  /** Records one message of the client. */
  public send(message: string): void {
    this.sent.push(message);
  }

  /** The server accepted the channel. */
  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The server sends one event. */
  public emit(event: RemoteConsoleEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** The channel is lost, as the browser reports a close. */
  public drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  /** What the client sent, decoded. */
  public commands(): unknown[] {
    return this.sent.map((text) => JSON.parse(text) as unknown);
  }
}

/** The channel the client opened last. */
export function latestChannel(): FakeWebSocket {
  const channel = FakeWebSocket.instances.at(-1);
  if (!channel) throw new Error("No channel was opened.");
  return channel;
}

/** The parts of xterm the client uses, with parser callbacks held back. */
export interface FakeTerminal {
  cols: number;
  rows: number;
  options: { disableStdin: boolean };
  readonly written: string[];
  readonly parsed: (() => void)[];
  readonly write: (chunk: string, callback: () => void) => void;
}

/** A terminal of 100 by 30 characters that processes output only when told. */
export function createTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    cols: 100,
    rows: 30,
    options: { disableStdin: false },
    written: [],
    parsed: [],
    write: (chunk, callback) => {
      terminal.written.push(chunk);
      terminal.parsed.push(callback);
    },
  };
  return terminal;
}

/** A console state that starts from the initial one. */
export function state(
  overrides: Partial<RemoteConsoleState> = {},
): RemoteConsoleState {
  return { ...INITIAL_CONSOLE_STATE, ...overrides };
}

/** A sequenced state event. */
export function stateEvent(
  sequence: number,
  overrides: Partial<RemoteConsoleState> = {},
): RemoteConsoleEvent {
  return { kind: "state", sequence, state: state(overrides) };
}

/** A server answer of the fetch boundary. */
export function answer(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

/** The JSON bodies the client posted. */
export function postedBodies(fetchMock: FetchMock): unknown[] {
  return fetchMock.mock.calls.map(
    ([, init]: [string, RequestInit]) =>
      JSON.parse(String(init.body)) as unknown,
  );
}

/** The fetch boundary: every request is recorded. */
type FetchRequest = (...request: [string, RequestInit]) => Promise<Response>;
export type FetchMock = Mock<FetchRequest>;

/** A client with its fake terminal and fetch boundary. */
export interface Harness {
  readonly client: RemoteConsoleClient;
  readonly terminal: FakeTerminal;
  readonly states: RemoteConsoleState[];
  readonly onGap: Mock<() => void>;
  readonly fetchMock: FetchMock;
}

/** Creates a client whose fetch answers come from the queue, else with a session. */
export function createHarness(
  endpoint = ENDPOINT,
  responses: readonly (() => Promise<Response>)[] = [],
): Harness {
  const terminal = createTerminal();
  const states: RemoteConsoleState[] = [];
  const onGap = vi.fn<() => void>();
  const queue = [...responses];
  const fetchMock = vi.fn<FetchRequest>(
    () =>
      queue.shift()?.() ?? Promise.resolve(answer({ sessionId: SESSION_ID })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new RemoteConsoleClient({
    endpoint,
    terminal: terminal as unknown as Terminal,
    onState: (next) => states.push(next),
    notices: { onGap },
  });
  return { client, terminal, states, onGap, fetchMock };
}

/** Starts a client and lets the open request settle, so a channel exists. */
export async function startConnected(harness: Harness): Promise<FakeWebSocket> {
  await harness.client.start();
  const channel = latestChannel();
  channel.open();
  channel.emit(stateEvent(1, { status: "connected" }));
  return channel;
}

/** Fake timers and the fake channel for one test. */
export function installConsoleGlobals(): void {
  vi.useFakeTimers();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
}

/** Returns timers and globals to the real ones. */
export function restoreConsoleGlobals(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
