import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";

import { fakeChild } from "./fake-child-process";

import type {
  CliWorkerUnitHandle,
  CliWorkerUnitResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliSessionCallbacks } from "@/backend/agents/cli/CliSessionProcess";
import type { FakeChild } from "./fake-child-process";
import type { Mock } from "vitest";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logging);

const LINE_LIMIT = 8 * 1024 * 1024;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  logging.logCaughtError.mockReset();
  logging.logEvent.mockReset();
});

function start(
  fake: FakeChild,
  callbacks: Partial<CliSessionCallbacks> = {},
  signalGroup = vi.fn(),
): { readonly session: CliSessionProcess; readonly lines: string[] } {
  const lines: string[] = [];
  const session = new CliSessionProcess(
    fake.child,
    {
      timeoutMs: 0,
      signal: new AbortController().signal,
      onLine: (line) => {
        lines.push(line);
      },
      ...callbacks,
    },
    signalGroup,
  );
  return { session, lines };
}

function unit(
  settle: () => Promise<CliWorkerUnitResult>,
): CliWorkerUnitHandle & {
  readonly signal: Mock<(signal: NodeJS.Signals) => void>;
  readonly started: Mock<() => void>;
} {
  return {
    name: "unit",
    signal: vi.fn<(signal: NodeJS.Signals) => void>(),
    started: vi.fn<() => void>(),
    settle,
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

it("streams complete non-empty lines and keeps the stderr tail", async () => {
  const fake = fakeChild();
  const { session, lines } = start(fake);

  fake.stdout.write("one\n\n  \ntw");
  fake.stdout.write("o\nthree");
  fake.stderr.write("e".repeat(20_000));
  await flush();
  fake.child.emit("close", 0, null);

  await expect(session.exited).resolves.toEqual({
    code: 0,
    signal: null,
    errorCode: null,
    stderrTail: "e".repeat(16 * 1024),
  });
  expect(lines).toEqual(["one", "two", "three"]);
  await expect(session.completed).resolves.toMatchObject({
    exitCode: 0,
    stdout: "",
  });
  expect(session.processId).toBe(77);
});

it("ends the session after the exit when a descendant keeps the output open", async () => {
  const fake = fakeChild();
  const { session } = start(fake);

  fake.child.emit("exit", 3, null);
  await vi.advanceTimersByTimeAsync(2_000);

  await expect(session.exited).resolves.toMatchObject({ code: 3 });
});

it("takes the exit status when the close event carries none", async () => {
  const fake = fakeChild();
  const { session } = start(fake);

  fake.child.emit("exit", null, "SIGTERM");
  fake.child.emit("close", null, null);

  await expect(session.exited).resolves.toMatchObject({
    code: null,
    signal: "SIGTERM",
  });
});

it("reports a runner that cannot be executed", async () => {
  const fake = fakeChild(null);
  const { session } = start(fake);

  fake.child.emit("error", new Error("ENOENT"));

  await expect(session.exited).resolves.toMatchObject({
    code: null,
    errorCode: "cli_not_executable",
  });
  expect(session.processId).toBeNull();
});

it("keeps the cancellation code when the runner fails while it stops", async () => {
  const fake = fakeChild();
  const { session } = start(fake);

  session.cancel("login_cancelled");
  fake.child.emit("error", new Error("EPIPE"));

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "login_cancelled",
  });
});

it("kills the group at the deadline", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const { session } = start(fake, { timeoutMs: 1_000 }, signalGroup);

  await vi.advanceTimersByTimeAsync(1_000);
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGKILL");
  fake.child.emit("close", null, "SIGKILL");

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "check_timeout",
  });
});

it("terminates first and kills after the grace period", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const { session } = start(fake, {}, signalGroup);

  session.cancel("login_cancelled");
  session.cancel("check_timeout");
  expect(signalGroup).toHaveBeenCalledTimes(1);
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5_000);

  expect(signalGroup).toHaveBeenLastCalledWith(-77, "SIGKILL");
  fake.child.emit("close", null, "SIGKILL");
  await session.exited;
  session.cancel("login_cancelled");
  expect(signalGroup).toHaveBeenCalledTimes(2);
});

it.each([
  ["a deadline", new DOMException("late", "TimeoutError"), "check_timeout"],
  ["a stop", new DOMException("stop", "AbortError"), "login_cancelled"],
] as const)(
  "maps an already aborted signal for %s",
  async (_, reason, code) => {
    const fake = fakeChild();
    const controller = new AbortController();
    controller.abort(reason);
    const { session } = start(fake, { signal: controller.signal });

    fake.child.emit("close", null, "SIGTERM");

    await expect(session.exited).resolves.toMatchObject({ errorCode: code });
  },
);

it("signals the runner directly when its group is gone", () => {
  const fake = fakeChild();
  const { session } = start(
    fake,
    {},
    vi.fn(() => {
      throw new Error("ESRCH");
    }),
  );

  session.cancel("login_cancelled");

  expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
});

it("signals the unit even without a process group", async () => {
  const fake = fakeChild(null);
  const handle = unit(async () => "success");
  const signalGroup = vi.fn();
  const { session } = start(fake, { unit: handle }, signalGroup);

  session.cancel("login_cancelled");

  expect(handle.signal).toHaveBeenCalledWith("SIGTERM");
  expect(signalGroup).not.toHaveBeenCalled();
});

it("writes lines only to an open input", async () => {
  const fake = fakeChild();
  const received: string[] = [];
  fake.stdin.on("data", (chunk: Buffer) => received.push(chunk.toString()));
  const { session } = start(fake);

  expect(session.write("first")).toBe(true);
  await expect(session.writeAsync("second")).resolves.toBe(true);
  session.endInput();
  session.endInput();

  expect(received).toEqual(["first\n", "second\n"]);
  expect(session.write("late")).toBe(false);
  await expect(session.writeAsync("late")).resolves.toBe(false);
});

it("refuses writes after the session ended", async () => {
  const fake = fakeChild();
  const { session } = start(fake);
  fake.child.emit("close", 0, null);
  await session.exited;

  expect(session.write("late")).toBe(false);
  await expect(session.writeAsync("late")).resolves.toBe(false);
});

it("reports a failed asynchronous write", async () => {
  const fake = fakeChild();
  const { session } = start(fake);
  vi.spyOn(fake.stdin, "write").mockImplementation(
    (chunk: unknown, callback?: unknown) => {
      if (typeof callback === "function") callback(new Error("EPIPE"));
      return false;
    },
  );

  await expect(session.writeAsync("line")).resolves.toBe(false);
});

it("refuses to write an oversized input line", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const { session } = start(fake, {}, signalGroup);

  await expect(session.writeAsync("x".repeat(LINE_LIMIT + 1))).resolves.toBe(
    false,
  );
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
});

it("ends a session whose output line exceeds the limit", async () => {
  const fake = fakeChild();
  const { session, lines } = start(fake);

  fake.stdout.write(`${"x".repeat(LINE_LIMIT + 1)}\nnext\n`);
  await flush();
  fake.stdout.write("after\n");
  await flush();
  fake.child.emit("close", null, "SIGTERM");

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "acp_output_overflow",
  });
  expect(lines).toEqual([]);
});

it("ends a session whose unterminated output exceeds the limit", async () => {
  const fake = fakeChild();
  const { session } = start(fake);

  fake.stdout.write("y".repeat(LINE_LIMIT + 1));
  await flush();
  fake.child.emit("close", null, "SIGTERM");

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "acp_output_overflow",
  });
});

it("cancels when the line receiver fails", async () => {
  const fake = fakeChild();
  const { session } = start(fake, {
    onLine: async () => {
      throw new Error("journal failed");
    },
  });

  fake.stdout.write("line\n");
  await flush();
  fake.child.emit("close", null, "SIGTERM");

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "plan_history_unavailable",
  });
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliSessionProcess",
    expect.any(Error),
  );
});

it("marks the history broken when the final partial line cannot be delivered", async () => {
  const fake = fakeChild();
  const { session } = start(fake, {
    onLine: async () => {
      throw new Error("journal failed");
    },
  });

  fake.stdout.write("partial");
  await flush();
  fake.child.emit("close", 0, null);

  await expect(session.exited).resolves.toMatchObject({
    code: 0,
    errorCode: "plan_history_unavailable",
  });
});

it.each([
  ["oom-kill", "acp_worker_limit"],
  ["resources", "acp_worker_limit"],
  ["timeout", "check_timeout"],
  ["success", null],
] as const)("settles a unit that ended with %s", async (result, code) => {
  const fake = fakeChild();
  const handle = unit(async () => result);
  const { session } = start(fake, { unit: handle });

  fake.stdout.write("line\n");
  await flush();
  fake.child.emit("close", 0, null);

  await expect(session.exited).resolves.toMatchObject({ errorCode: code });
  expect(handle.started).toHaveBeenCalled();
});

it("keeps the decision of Pages over the unit result", async () => {
  const fake = fakeChild();
  const { session } = start(fake, { unit: unit(async () => "oom-kill") });

  session.cancel("login_cancelled");
  fake.child.emit("close", null, "SIGTERM");

  await expect(session.exited).resolves.toMatchObject({
    errorCode: "login_cancelled",
  });
});

it("ends the session even when its unit cannot be settled", async () => {
  const fake = fakeChild();
  const { session } = start(fake, {
    unit: unit(async () => {
      throw new Error("systemctl failed");
    }),
  });

  fake.child.emit("close", 1, null);

  await expect(session.exited).resolves.toMatchObject({
    code: 1,
    errorCode: null,
  });
});

it("ignores a closed input and finishes only once", async () => {
  const fake = fakeChild();
  const { session } = start(fake);

  fake.stdin.emit("error", new Error("EPIPE"));
  fake.child.emit("error", new Error("spawn failed"));
  fake.child.emit("close", 1, null);

  await expect(session.exited).resolves.toMatchObject({
    code: null,
    errorCode: "cli_not_executable",
  });
  expect(
    logging.logEvent.mock.calls.filter(
      ([entry]) => entry.event === "cli.process.exited",
    ),
  ).toHaveLength(1);
});

it("delivers a line that is still being received when the runner closes", async () => {
  const fake = fakeChild();
  let release: () => void = () => undefined;
  const lines: string[] = [];
  const { session } = start(fake, {
    onLine: async (line) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      lines.push(line);
    },
  });

  fake.stdout.write("slow\n");
  await flush();
  fake.child.emit("close", 0, null);
  release();

  await expect(session.exited).resolves.toMatchObject({ code: 0 });
  expect(lines).toEqual(["slow"]);
  expect(fake.stdout.isPaused()).toBe(true);
});
