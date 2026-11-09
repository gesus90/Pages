import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TerminalSession } from "@/backend/agents/terminal/TerminalSession";

import { sessionInput } from "../cli/cli-session-input";

import type { TerminalSessionContext } from "@/backend/agents/terminal/TerminalSession";
import type { TerminalMonitorEvents } from "@/backend/agents/terminal/TerminalLaunch";
import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A session over fake parts; the monitor's events are driven by the test. */
function fakeSession(): {
  readonly session: TerminalSession;
  readonly events: () => TerminalMonitorEvents;
  readonly store: {
    readonly activate: ReturnType<typeof vi.fn>;
    readonly question: ReturnType<typeof vi.fn>;
    readonly end: ReturnType<typeof vi.fn>;
  };
  readonly pasted: string[];
  readonly exit: (exit: CliSessionExit) => void;
} {
  let monitorEvents: TerminalMonitorEvents | null = null;
  let exit: (value: CliSessionExit) => void = () => undefined;
  const exited = new Promise<CliSessionExit>((resolve) => {
    exit = resolve;
  });
  const pasted: string[] = [];
  const store = {
    activate: vi.fn(async () => undefined),
    question: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
  };
  const context: TerminalSessionContext = {
    instanceId: "process",
    stepId: "writer",
    launch: {
      monitor: {
        start: async (events: TerminalMonitorEvents) => {
          monitorEvents = events;
        },
        close: async () => undefined,
      },
      questionPattern: null,
      sessionId: "session-1",
    },
    process: {
      exited,
      isRunning: true,
      cancel: vi.fn(),
      endInput: vi.fn(),
    },
    recorder: { finish: async () => undefined },
    screen: { text: () => "", dispose: vi.fn() },
    inputs: {
      paste: async (text: string) => {
        pasted.push(text);
      },
      stop: vi.fn(),
    },
    store,
    observer: { started: vi.fn(), identified: vi.fn() },
    signal: new AbortController().signal,
    redact: (text: string) => text.replaceAll("SECRET", "[redacted]"),
    effective: { mode: "yolo" },
    isPidNamespace: true,
    secure: async () => undefined,
  };
  return {
    session: new TerminalSession(context),
    events: () => {
      if (!monitorEvents) throw new Error("monitor not started");
      return monitorEvents;
    },
    store,
    pasted,
    exit,
  };
}

it("ends the turn with the answer the CLI reported, redacted", async () => {
  const world = fakeSession();
  await vi.advanceTimersByTimeAsync(0);
  world.events().turnEnded({ status: "completed", output: "done with SECRET" });
  await vi.advanceTimersByTimeAsync(1_500);
  const turn = await world.session.turn;
  expect(turn).toMatchObject({
    failure: null,
    output: "done with [redacted]",
    sessionId: "session-1",
  });
  expect(turn.effective.surface).toBe("terminal");
  expect(world.store.activate).toHaveBeenCalledWith("process", "writer");
});

it("fails the node at once for an open question and records the question", async () => {
  const world = fakeSession();
  await vi.advanceTimersByTimeAsync(0);
  world.events().question("Allow rm -rf build?");
  const turn = await world.session.turn;
  expect(turn.failure).toBe("failed");
  expect(turn.errorCode).toBe("plan_terminal_question");
  expect(turn.output).toContain("Allow rm -rf build?");
  expect(world.store.question).toHaveBeenCalledWith(
    "process",
    "Allow rm -rf build?",
  );
});

it("fails the turn when the CLI ends during it", async () => {
  const world = fakeSession();
  world.exit({ code: 1, signal: null, errorCode: null, stderrTail: "" });
  const turn = await world.session.turn;
  expect(turn.failure).toBe("failed");
  expect(turn.errorCode).toBe("plan_step_failed");
});

it("pastes the next step of a group and marks its member active", async () => {
  const world = fakeSession();
  await vi.advanceTimersByTimeAsync(0);
  world.events().turnEnded({ status: "completed", output: "first" });
  await vi.advanceTimersByTimeAsync(1_500);
  await world.session.turn;
  const next = world.session.next(
    sessionInput(
      "opencode",
      { access: "yolo", shell: true, web: true, timeoutMinutes: 10 },
      {
        prompt: "Review the change",
        resourceContext: { runId: "run-1", stepId: "reviewer" },
      },
    ),
    new AbortController().signal,
    { started: vi.fn(), identified: vi.fn() },
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(world.pasted).toEqual(["Review the change"]);
  world.events().turnEnded({ status: "completed", output: "second" });
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(next).resolves.toMatchObject({ output: "second" });
  expect(world.store.activate).toHaveBeenLastCalledWith("process", "reviewer");
});
