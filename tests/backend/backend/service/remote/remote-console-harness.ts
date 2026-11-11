import { vi } from "vitest";

import { RemoteConsoleSession } from "@/backend/service/remote/RemoteConsoleSession";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { SshPty } from "@/backend/remote/SshPty";
import type {
  ConductorControl,
  ConductorExit,
  RemoteConsoleConductor,
} from "@/backend/service/remote/RemoteConsoleConductor";
import type { RemoteConsoleTarget } from "@/backend/service/remote/RemoteConsoleSession";
import type {
  RemoteConsoleEvent,
  RemoteConsoleSize,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";
import type { SetupProgress } from "@/definition/RemoteSetup";

export const SIZE: RemoteConsoleSize = { columns: 80, rows: 24 };
export const SSH_FAILURE = 255;
export const PATH = "/work/project";

/** A promise with its settle functions. */
export interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

/** Creates a promise that the test settles. */
export function deferred<Value>(): Deferred<Value> {
  let resolve: Deferred<Value>["resolve"] = () => undefined;
  let reject: Deferred<Value>["reject"] = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** A terminal whose lifecycle the test drives. */
export interface FakePty {
  readonly terminal: SshPty;
  readonly write: ReturnType<typeof vi.fn<(input: string) => void>>;
  readonly resize: ReturnType<
    typeof vi.fn<(columns: number, rows: number) => void>
  >;
  readonly close: ReturnType<typeof vi.fn<() => void>>;
  readonly exit: (code: number) => void;
  readonly firstOutput: (isShell: boolean) => void;
  readonly refuse: () => void;
}

/** Creates a fake terminal that has not printed or exited yet. */
export function createPty(): FakePty {
  const exited = deferred<number>();
  const first = deferred<boolean>();
  let isRefused = false;
  const write = vi.fn<(input: string) => void>();
  const resize = vi.fn<(columns: number, rows: number) => void>();
  const close = vi.fn<() => void>();
  const terminal = {
    write,
    resize,
    close,
    exited: exited.promise,
    firstOutput: first.promise,
    wasRefused: () => isRefused,
  } as unknown as SshPty;
  return {
    terminal,
    write,
    resize,
    close,
    exit: exited.resolve,
    firstOutput: first.resolve,
    refuse: () => {
      isRefused = true;
    },
  };
}

/** What the console asks the session to open. */
export interface OpenRequest {
  readonly columns: number;
  readonly rows: number;
  readonly path: string | null;
  readonly command: string | null;
  readonly onOutput: (chunk: string) => void;
}

/** A fake connection with spies on its remote calls. */
export interface FakeSession {
  readonly session: RemoteSession;
  readonly run: ReturnType<typeof vi.fn>;
  readonly openPty: ReturnType<typeof vi.fn<(request: OpenRequest) => unknown>>;
  readonly attemptNow: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

/** Creates a fake connection that opens terminals through `open`. */
export function createSession(
  open: (request: OpenRequest) => Promise<SshPty> | SshPty,
): FakeSession {
  const run = vi.fn();
  const openPty = vi.fn<(request: OpenRequest) => unknown>(open);
  const attemptNow = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const session = { run, openPty, attemptNow } as unknown as RemoteSession;
  return { session, run, openPty, attemptNow };
}

/** A console whose shell opens at once and whose events are collected. */
export function startConsole(options: {
  readonly target: () => Promise<RemoteConsoleTarget>;
  readonly restored?: { lastSequence: number; attempts: number };
}): {
  readonly console: RemoteConsoleSession;
  readonly events: RemoteConsoleEvent[];
} {
  const console = new RemoteConsoleSession(
    options.target,
    SIZE,
    options.restored,
  );
  const events: RemoteConsoleEvent[] = [];
  console.follow(0, (event) => events.push(event));
  return { console, events };
}

/** A target resolver that returns the fake connection. */
export function targetOf(
  fake: FakeSession,
  rest: Partial<RemoteConsoleTarget> = {},
): () => Promise<RemoteConsoleTarget> {
  return vi.fn(() =>
    Promise.resolve({ session: fake.session, path: PATH, ...rest }),
  );
}

/** Lets pending promises and zero-delay timers run. */
export async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Opens a console on a fake shell that printed its first output. */
export async function connectedConsole(
  fake?: FakeSession,
  pty = createPty(),
  rest: Partial<RemoteConsoleTarget> = {},
): Promise<{
  readonly console: RemoteConsoleSession;
  readonly events: RemoteConsoleEvent[];
  readonly pty: FakePty;
  readonly fake: FakeSession;
  readonly target: () => Promise<RemoteConsoleTarget>;
}> {
  const session = fake ?? createSession(() => pty.terminal);
  const target = targetOf(session, rest);
  const { console, events } = startConsole({ target });
  await settle();
  pty.firstOutput(true);
  await settle();
  return { console, events, pty, fake: session, target };
}

/** The state of every state event, in order. */
export function states(
  events: readonly RemoteConsoleEvent[],
): RemoteConsoleState[] {
  return events.flatMap((event) =>
    event.kind === "state" ? [event.state] : [],
  );
}

/** The latest state event. */
export function lastState(
  events: readonly RemoteConsoleEvent[],
): RemoteConsoleState {
  const last = states(events).at(-1);
  if (!last) throw new Error("No state event");
  return last;
}

/** A guided command whose calls are spied on. */
export interface FakeConductor {
  readonly conductor: RemoteConsoleConductor;
  readonly prepare: ReturnType<
    typeof vi.fn<(control: ConductorControl) => Promise<void>>
  >;
  readonly terminalOpened: ReturnType<
    typeof vi.fn<(control: ConductorControl) => void>
  >;
  readonly finish: ReturnType<
    typeof vi.fn<
      (exit: ConductorExit, control: ConductorControl) => Promise<void>
    >
  >;
  readonly abort: ReturnType<
    typeof vi.fn<(error: unknown, control: ConductorControl) => void>
  >;
  readonly control: () => ConductorControl;
  hasStarted: boolean;
}

/** Creates a conductor that upper-cases output and finishes at once. */
export function createConductor(): FakeConductor {
  let control: ConductorControl | null = null;
  const prepare = vi.fn<(control: ConductorControl) => Promise<void>>(
    (given) => {
      control = given;
      return Promise.resolve();
    },
  );
  const terminalOpened = vi.fn<(control: ConductorControl) => void>();
  const finish = vi.fn<
    (exit: ConductorExit, control: ConductorControl) => Promise<void>
  >(() => Promise.resolve());
  const abort = vi.fn<(error: unknown, control: ConductorControl) => void>();
  const fake: FakeConductor = {
    prepare,
    terminalOpened,
    finish,
    abort,
    hasStarted: false,
    control: () => {
      if (!control) throw new Error("Conductor not prepared");
      return control;
    },
    conductor: {
      command: "runner-setup --yes",
      hasStarted: () => fake.hasStarted,
      prepare,
      terminalOpened,
      filter: (chunk) => chunk.toUpperCase(),
      finish,
      abort,
    },
  };
  return fake;
}

export const PROGRESS: SetupProgress = {
  phases: ["done", "active", "pending"],
  step: null,
  outcome: null,
  reason: null,
} as unknown as SetupProgress;
