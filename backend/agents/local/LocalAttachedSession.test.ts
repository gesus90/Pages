import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalAttachedSession } from "@/backend/agents/local/LocalAttachedSession";
import {
  localTurnSchema,
  type LocalJournalRecord,
  type LocalSessionCommand,
  type LocalSessionLaunch,
  type LocalSessionMutation,
} from "@/backend/agents/local/LocalSessionContracts";
import { LocalSessionImport } from "@/backend/agents/local/LocalSessionImport";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Mock } from "vitest";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

type Dependencies = ConstructorParameters<typeof LocalAttachedSession>[3];

const logCaughtError = vi.hoisted(() => vi.fn());
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError }));

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST = "a".repeat(64);

const LAUNCH: LocalSessionLaunch = {
  runId: FIRST_ID,
  stepId: "step",
  sessionScopeId: "scope",
  attemptId: FIRST_ID,
  turnId: FIRST_ID,
  isInstruction: false,
  instanceId: FIRST_ID,
  userId: FIRST_ID,
  prompt: "prompt",
  instruction: "instruction",
  resumeSessionId: null,
  timeoutMinutes: 5,
  mcp: null,
};
const NEXT_LAUNCH: LocalSessionLaunch = { ...LAUNCH, turnId: SECOND_ID };
const INPUT: AgentPlanExecutionInput = {
  agent: {
    connection: {
      isActive: true,
      id: "connection",
      name: "Connection",
      provider: "claude_code",
      hasApiKey: false,
      testModel: null,
      reasoningEffort: null,
      cliLoggedInAt: null,
      cliAccountLabel: null,
      updatedAt: "2026-01-01T00:00:00Z",
    },
    model: "model",
    reasoningEffort: null,
  },
  userId: FIRST_ID,
  prompt: "next prompt",
  directory: null,
};
const CLOSED = {
  exit: null,
  endedAt: "2026-01-01T00:00:00Z",
  leftovers: 0,
  isConfirmed: true,
};
const RESULT = localTurnSchema.parse({
  output: "done",
  sessionId: null,
  failure: null,
  errorCode: null,
  endedAt: "2026-01-01T00:00:00Z",
  permissionDenials: 0,
  effective: {},
  events: [],
});
const POSITION: LocalSessionMutation = {
  kind: "position",
  turns: 0,
  attemptId: FIRST_ID,
  turnId: FIRST_ID,
};
const CLOSED_MUTATION: LocalSessionMutation = {
  kind: "closed",
  result: CLOSED,
};
const RECORD: LocalJournalRecord = {
  sequence: 1,
  previousDigest: "",
  digest: DIGEST,
  payload: "p",
};
const STARTED: LocalSessionMutation = {
  kind: "started",
  details: {
    mode: "interactive",
    processId: 1,
    startedAt: "2026-01-01T00:00:00Z",
    arguments: [],
    unattended: "yes",
  },
};

function turnMutation(turnId: string): LocalSessionMutation {
  return { kind: "turn", attemptId: FIRST_ID, turnId, result: RESULT };
}

function createObserver(): PlanSessionObserver {
  return {
    started: vi.fn(),
    identified: vi.fn(),
    capabilities: vi.fn(),
    progressed: vi.fn(),
    activity: vi.fn(),
  };
}

function blankImporter(): LocalSessionImport {
  const value: unknown = Object.create(LocalSessionImport.prototype);
  if (!(value instanceof LocalSessionImport)) throw new Error("no importer");
  return value;
}

async function defaultControl(command: LocalSessionCommand): Promise<unknown> {
  if (command.kind === "read") return { records: [] };
  if (command.kind === "close") return { closed: CLOSED };
  return {};
}

interface Fixture {
  readonly session: LocalAttachedSession;
  readonly controller: AbortController;
  readonly observer: PlanSessionObserver;
  readonly control: Mock<Dependencies["control"]>;
  readonly completion: Mock<Dependencies["completion"]>;
  readonly namespace: Mock<Dependencies["namespace"]>;
  readonly restore: Mock<LocalSessionImport["restore"]>;
  readonly refresh: Mock<LocalSessionImport["refresh"]>;
  readonly take: Mock<LocalSessionImport["take"]>;
  readonly acknowledgement: Mock<() => LocalSessionImport["acknowledgement"]>;
}

function createFixture(observer = createObserver()): Fixture {
  const controller = new AbortController();
  const importer = blankImporter();
  const restore = vi.spyOn(importer, "restore").mockResolvedValue([]);
  const refresh = vi.spyOn(importer, "refresh").mockResolvedValue([]);
  const take = vi.spyOn(importer, "take").mockResolvedValue(POSITION);
  vi.spyOn(importer, "cursor", "get").mockReturnValue(5);
  const acknowledgement = vi
    .spyOn(importer, "acknowledgement", "get")
    .mockReturnValue({ sequence: 0, digest: "" });
  const control = vi.fn<Dependencies["control"]>(defaultControl);
  const completion = vi.fn<Dependencies["completion"]>(async () => null);
  const namespace = vi.fn<Dependencies["namespace"]>(async () => undefined);
  const session = new LocalAttachedSession(
    LAUNCH,
    controller.signal,
    observer,
    {
      importer,
      control,
      completion,
      nextLaunch: () => NEXT_LAUNCH,
      namespace,
    },
  );
  return {
    session,
    controller,
    observer,
    control,
    completion,
    namespace,
    restore,
    refresh,
    take,
    acknowledgement,
  };
}

function kinds(control: Fixture["control"]): string[] {
  return control.mock.calls.map(([command]) => command.kind);
}

beforeEach(() => {
  vi.useFakeTimers();
  logCaughtError.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

it("restores milestones and delivers them to the observer", async () => {
  const { session, observer, restore, completion, namespace, control } =
    createFixture();
  restore.mockResolvedValue([
    POSITION,
    STARTED,
    { kind: "identified", sessionId: "native" },
    {
      kind: "capabilities",
      capabilities: { canResume: true, canLoad: false, adapter: "a" },
    },
    { kind: "progressed", events: ["e"] },
    {
      kind: "activity",
      activity: { reportedAt: "2026-01-01T00:00:00Z", titles: ["t"] },
    },
    turnMutation(SECOND_ID),
  ]);
  completion.mockResolvedValue(turnMutation(FIRST_ID));
  await session.attach();
  expect(namespace).toHaveBeenCalledWith(STARTED);
  expect(observer.started).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "interactive" }),
  );
  expect(observer.identified).toHaveBeenCalledWith("native");
  expect(observer.capabilities).toHaveBeenCalled();
  expect(observer.progressed).toHaveBeenCalledWith(["e"]);
  expect(observer.activity).toHaveBeenCalled();
  await expect(session.turn).resolves.toBe(RESULT);
  expect(session.isDurable).toBe(true);
  expect(kinds(control)).toEqual(["read"]);
  session.detach();
});

it("tolerates an observer without optional callbacks", async () => {
  const { session, restore } = createFixture({
    started: vi.fn(),
    identified: vi.fn(),
  });
  restore.mockResolvedValue([
    {
      kind: "capabilities",
      capabilities: { canResume: true, canLoad: false, adapter: "a" },
    },
    { kind: "progressed", events: [] },
    { kind: "activity", activity: { reportedAt: "t", titles: [] } },
  ]);
  await session.attach();
  session.detach();
});

it("repeats a committed acknowledgement and imports journal records", async () => {
  const { session, control, take, acknowledgement } = createFixture();
  acknowledgement.mockReturnValue({ sequence: 3, digest: DIGEST });
  control.mockImplementation(async (command) =>
    command.kind === "read" && control.mock.calls.length < 3
      ? { records: [RECORD] }
      : defaultControl(command),
  );
  await session.attach();
  expect(take).toHaveBeenCalledWith(RECORD);
  expect(control).toHaveBeenCalledWith({
    kind: "ack",
    sequence: 3,
    digest: DIGEST,
  });
  expect(control).toHaveBeenCalledWith({
    kind: "ack",
    sequence: 1,
    digest: DIGEST,
  });
  expect(control).toHaveBeenCalledWith({ kind: "read", after: 5, limit: 100 });
  await vi.advanceTimersByTimeAsync(250);
  expect(kinds(control).filter((kind) => kind === "read")).toHaveLength(2);
  session.detach();
  await vi.advanceTimersByTimeAsync(1000);
  expect(kinds(control).filter((kind) => kind === "read")).toHaveLength(2);
});

it("shares a read already in flight and replaces the poll timer", async () => {
  const { session, control } = createFixture();
  await session.attach();
  let release: (answer: unknown) => void = () => undefined;
  control.mockImplementationOnce(
    () =>
      new Promise<unknown>((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(250);
  const second = session.attach();
  await vi.advanceTimersByTimeAsync(0);
  release({ records: [] });
  await second;
  expect(kinds(control).filter((kind) => kind === "read")).toHaveLength(2);
  session.detach();
});

it("stops importing when detached while reading", async () => {
  const { session, control, take } = createFixture();
  control.mockImplementation(async (command) => {
    if (command.kind !== "read") return {};
    session.detach();
    return { records: [RECORD] };
  });
  await session.attach();
  expect(take).not.toHaveBeenCalled();
  expect(session.isDetached).toBe(true);
});

it("stops delivering when detached while importing a record", async () => {
  const { session, control, take, observer } = createFixture();
  control.mockResolvedValueOnce({ records: [RECORD] });
  take.mockImplementation(async () => {
    session.detach();
    return { kind: "identified", sessionId: "late" };
  });
  await session.attach();
  expect(observer.identified).not.toHaveBeenCalled();
  expect(kinds(control)).toEqual(["read"]);
});

it("ignores a read failure that arrives after detaching", async () => {
  const { session, control } = createFixture();
  control.mockImplementation(async () => {
    session.detach();
    throw new Error("late");
  });
  await session.attach();
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("refreshes from the database after a read failure", async () => {
  const { session, refresh, completion, control, observer } = createFixture();
  refresh.mockResolvedValue([{ kind: "identified", sessionId: "native" }]);
  completion
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(turnMutation(FIRST_ID));
  control.mockRejectedValueOnce(new Error("lost"));
  await session.attach();
  expect(logCaughtError).toHaveBeenCalledWith(
    "LocalAttachedSession",
    expect.any(Error),
  );
  expect(observer.identified).toHaveBeenCalledWith("native");
  await expect(session.turn).resolves.toBe(RESULT);
  session.detach();
});

it("acknowledges a refreshed cursor and logs a failed refresh", async () => {
  const { session, refresh, acknowledgement, control } = createFixture();
  acknowledgement
    .mockReturnValueOnce({ sequence: 0, digest: "" })
    .mockReturnValue({ sequence: 2, digest: DIGEST });
  control.mockRejectedValueOnce(new Error("lost"));
  await session.attach();
  expect(control).toHaveBeenCalledWith({
    kind: "ack",
    sequence: 2,
    digest: DIGEST,
  });
  refresh.mockRejectedValueOnce(new Error("gone"));
  control.mockRejectedValueOnce(new Error("lost again"));
  await vi.advanceTimersByTimeAsync(250);
  expect(logCaughtError).toHaveBeenCalledTimes(3);
  session.detach();
});

it("skips the refresh result when detached meanwhile", async () => {
  const { session, refresh, observer, control } = createFixture();
  refresh.mockImplementation(async () => {
    session.detach();
    return [{ kind: "identified", sessionId: "late" }];
  });
  control.mockRejectedValueOnce(new Error("lost"));
  await session.attach();
  expect(observer.identified).not.toHaveBeenCalled();
});

it("fails the turn when the owner can no longer be verified", async () => {
  const { session, control } = createFixture();
  control.mockRejectedValueOnce(new AgentError("plan_local_owner_unverified"));
  await session.attach();
  await expect(session.turn).rejects.toMatchObject({
    code: "plan_local_owner_unverified",
  });
  expect(session.isDetached).toBe(true);
});

it("observes with a new observer and signal", async () => {
  const { session, restore, controller } = createFixture();
  const observer = createObserver();
  const signal = new AbortController().signal;
  restore.mockResolvedValue([{ kind: "identified", sessionId: "again" }]);
  await session.observe(signal, observer);
  expect(observer.identified).toHaveBeenCalledWith("again");
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  session.detach();
});

it("cancels at once when observed with an aborted signal", async () => {
  const { session, control } = createFixture();
  const aborted = new AbortController();
  aborted.abort();
  await session.observe(aborted.signal, createObserver());
  await vi.advanceTimersByTimeAsync(0);
  expect(kinds(control)).toContain("cancel");
  session.detach();
});

it("cancels at once when attached with an aborted signal", async () => {
  const { session, control, controller } = createFixture();
  controller.abort();
  await session.attach();
  await vi.advanceTimersByTimeAsync(0);
  expect(kinds(control)).toContain("cancel");
  session.detach();
});

it("fails the turn when cancellation by abort fails", async () => {
  const { session, control, controller } = createFixture();
  control.mockRejectedValueOnce(new Error("no cancel"));
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  await expect(session.turn).rejects.toMatchObject({
    code: "plan_local_owner_unverified",
  });
});

it("does not cancel a session that detached while sending the next turn", async () => {
  const { session, control } = createFixture();
  const controller = new AbortController();
  controller.abort();
  control.mockImplementation(async () => {
    session.detach();
    return {};
  });
  // Detaching leaves the turn pending because its result belongs to the owner.
  void session.next(INPUT, controller.signal, createObserver());
  await vi.advanceTimersByTimeAsync(0);
  expect(kinds(control)).toEqual(["next"]);
  expect(session.isDetached).toBe(true);
});

it("sends the next turn and resolves with its result", async () => {
  const { session, control, restore } = createFixture();
  const observer = createObserver();
  const next = session.next(INPUT, new AbortController().signal, observer);
  await vi.advanceTimersByTimeAsync(0);
  expect(control).toHaveBeenCalledWith({ kind: "next", launch: NEXT_LAUNCH });
  restore.mockResolvedValue([turnMutation(SECOND_ID)]);
  await session.observe(new AbortController().signal, observer);
  await expect(next).resolves.toBe(RESULT);
  session.detach();
});

it("cancels and drains an aborted next turn", async () => {
  const { session, control, take } = createFixture();
  control.mockResolvedValueOnce({}).mockResolvedValueOnce({});
  control.mockResolvedValueOnce({ records: [RECORD] });
  take.mockResolvedValueOnce(turnMutation(SECOND_ID));
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    session.next(INPUT, aborted.signal, createObserver()),
  ).resolves.toBe(RESULT);
  expect(kinds(control)).toEqual(["next", "cancel", "read", "ack", "read"]);
  session.detach();
});

it("refuses the next turn once closing or detached", async () => {
  const closing = createFixture();
  await closing.session.close().catch(() => undefined);
  await expect(
    closing.session.next(INPUT, new AbortController().signal, createObserver()),
  ).rejects.toMatchObject({ code: "plan_session_unavailable" });
  const detached = createFixture();
  detached.session.detach();
  await expect(
    detached.session.next(
      INPUT,
      new AbortController().signal,
      createObserver(),
    ),
  ).rejects.toMatchObject({ code: "plan_session_unavailable" });
});

it("steers only with text blocks through the owner", async () => {
  const { session, control } = createFixture();
  const image: ContentBlock = {
    type: "image",
    data: "",
    mimeType: "image/png",
  };
  await expect(
    session.steer([{ type: "text", text: "a" }, image]),
  ).resolves.toBe("failed");
  expect(control).not.toHaveBeenCalled();
  control.mockResolvedValue({ outcome: "injected" });
  await expect(
    session.steer([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
  ).resolves.toBe("injected");
  const command = control.mock.lastCall?.[0];
  if (command?.kind !== "steer") throw new Error("Expected a steer command");
  expect(command.prompt).toBe("a\nb");
  expect(typeof command.commandId).toBe("string");
});

it("drops a non-text block that appears after the text check", async () => {
  class UncheckedBlocks extends Array<ContentBlock> {
    /** Simulates a collection that exposes another block after validation. */
    public override some(): boolean {
      return false;
    }
  }
  const { session, control } = createFixture();
  const blocks = new UncheckedBlocks();
  blocks.push({ type: "text", text: "kept" });
  blocks.push({ type: "image", data: "", mimeType: "image/png" });
  control.mockResolvedValue({ outcome: "startedNewTurn" });
  await expect(session.steer(blocks)).resolves.toBe("startedNewTurn");
  expect(control).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: "kept" }),
  );
});

it.each([
  [{ interrupted: true }, true],
  [{ interrupted: false }, false],
  [null, false],
  ["interrupted", false],
])("reads the interrupt answer %j as %s", async (answer, expected) => {
  const { session, control } = createFixture();
  control.mockResolvedValue(answer);
  await expect(session.interrupt()).resolves.toBe(expected);
});

it("closes through the owner and confirms the imported history", async () => {
  const { session, control, take } = createFixture();
  control.mockResolvedValueOnce({ closed: CLOSED });
  control.mockResolvedValueOnce({ records: [RECORD] });
  take.mockResolvedValueOnce(CLOSED_MUTATION);
  const first = session.close();
  expect(session.close()).toBe(first);
  await expect(first).resolves.toEqual(CLOSED);
  expect(kinds(control)).toEqual(["close", "read", "ack", "read"]);
  expect(session.isClosing).toBe(true);
  expect(session.isClosed).toBe(true);
  expect(session.isDetached).toBe(true);
});

it("does not ask the owner again once closeout was restored", async () => {
  const { session, control, restore } = createFixture();
  restore.mockResolvedValue([
    { kind: "closed", result: { ...CLOSED, isConfirmed: false } },
  ]);
  await session.attach();
  await expect(session.close()).resolves.toMatchObject({ isConfirmed: false });
  expect(kinds(control)).not.toContain("close");
  expect(session.isClosed).toBe(false);
});

it("rejects a malformed close answer", async () => {
  const { session, control } = createFixture();
  control.mockResolvedValue({ closed: "yes" });
  await expect(session.close()).rejects.toThrow();
  expect(session.isClosing).toBe(false);
});

it("requires imported closeout history and allows a retry", async () => {
  const { session, control, take } = createFixture();
  await expect(session.close()).rejects.toThrow(
    "Native closeout history is not durably imported",
  );
  expect(session.isClosing).toBe(true);
  control.mockResolvedValueOnce({ records: [RECORD] });
  take.mockResolvedValueOnce(CLOSED_MUTATION);
  await expect(session.close()).resolves.toEqual(CLOSED);
});

it("rethrows an unresolved read failure while draining", async () => {
  const { session, control } = createFixture();
  const failure = new Error("unreadable");
  control.mockImplementation(async (command) => {
    if (command.kind === "read") throw failure;
    return defaultControl(command);
  });
  await expect(session.close()).rejects.toBe(failure);
});

it("waits for a read in flight before draining", async () => {
  const { session, control } = createFixture();
  await session.attach();
  let release: (answer: unknown) => void = () => undefined;
  control.mockImplementationOnce(
    () =>
      new Promise<unknown>((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(250);
  const closing = session.close().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(0);
  release({ records: [] });
  await expect(closing).resolves.toBeInstanceOf(Error);
});

it("does not report a session closed that detached while draining", async () => {
  const { session, control, take } = createFixture();
  control.mockImplementation(async (command) => {
    if (command.kind === "ack") session.detach();
    if (command.kind === "read" && kinds(control).includes("close"))
      return { records: [RECORD] };
    return defaultControl(command);
  });
  take.mockResolvedValueOnce(CLOSED_MUTATION);
  await expect(session.close()).resolves.toEqual(CLOSED);
  expect(session.isClosed).toBe(false);
});

it("does not deliver a start to a session detached by the namespace hook", async () => {
  const { session, restore, namespace, observer } = createFixture();
  restore.mockResolvedValue([STARTED]);
  namespace.mockImplementation(async () => session.detach());
  await session.attach();
  expect(observer.started).not.toHaveBeenCalled();
});
