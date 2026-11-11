import { afterEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { LocalAttachedSession } from "@/backend/agents/local/LocalAttachedSession";

import { ATTEMPT_ID, CLOSED, LAUNCH, stub } from "./local-sessions-fixture";

import type { LocalSessionImport } from "@/backend/agents/local/LocalSessionImport";
import type {
  LocalSessionCommand,
  LocalSessionMutation,
} from "@/backend/agents/local/LocalSessionContracts";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const result: Extract<LocalSessionMutation, { kind: "turn" }>["result"] = {
  output: "finished",
  sessionId: "native",
  failure: null,
  errorCode: null,
  endedAt: "now",
  permissionDenials: 0,
  effective: {},
  events: [],
};

interface AttachedFixture {
  session: LocalAttachedSession;
  controller: AbortController;
  importer: {
    take: Mock;
    restore: Mock;
    refresh: Mock;
    cursor: number;
    acknowledgement: { sequence: number; digest: string };
  };
  observer: {
    started: Mock;
    identified: Mock;
    capabilities: Mock;
    progressed: Mock;
    activity: Mock;
  };
  control: Mock<(command: LocalSessionCommand) => Promise<unknown>>;
  dependencies: { namespace: Mock };
}

function setup(mutations: LocalSessionMutation[] = []): AttachedFixture {
  const importer = {
    restore: vi.fn().mockResolvedValue(mutations),
    refresh: vi.fn().mockResolvedValue([]),
    take: vi.fn(),
    cursor: 3,
    acknowledgement: { sequence: 3, digest: "digest" },
  };
  const observer = {
    started: vi.fn(),
    identified: vi.fn(),
    capabilities: vi.fn(),
    progressed: vi.fn(),
    activity: vi.fn(),
  };
  const control = vi.fn(
    async (command: LocalSessionCommand): Promise<unknown> => {
      if (command.kind === "read") return { records: [] };
      if (command.kind === "close") return { closed: CLOSED };
      if (command.kind === "interrupt") return { interrupted: true };
      if (command.kind === "steer") return { outcome: "injected" };
      return {};
    },
  );
  const dependencies = {
    importer: stub<LocalSessionImport>(importer),
    control,
    completion: vi.fn().mockResolvedValue(null),
    nextLaunch: vi.fn().mockReturnValue(LAUNCH),
    namespace: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new AbortController();
  const session = new LocalAttachedSession(
    LAUNCH,
    controller.signal,
    observer,
    dependencies,
  );
  return { session, controller, importer, observer, control, dependencies };
}

afterEach(() => vi.useRealTimers());

it("restores milestones and the matching durable turn before acknowledging the cursor", async () => {
  vi.useFakeTimers();
  const started: Extract<LocalSessionMutation, { kind: "started" }> = {
    kind: "started",
    details: {
      mode: "interactive",
      processId: 12,
      startedAt: "now",
      arguments: [],
      unattended: "yes",
    },
  };
  const capabilities = { canResume: true, canLoad: false, adapter: "codex" };
  const activity = { reportedAt: "now", titles: ["working"] };
  const fixture = setup([
    started,
    { kind: "identified", sessionId: "native" },
    { kind: "capabilities", capabilities },
    { kind: "progressed", events: ["progress"] },
    { kind: "activity", activity },
    { kind: "position", turns: 1, attemptId: ATTEMPT_ID, turnId: ATTEMPT_ID },
    { kind: "turn", turnId: ATTEMPT_ID, attemptId: ATTEMPT_ID, result },
  ]);
  await fixture.session.attach();
  await expect(fixture.session.turn).resolves.toEqual(result);
  expect(fixture.dependencies.namespace).toHaveBeenCalledWith(started);
  expect(fixture.observer.started).toHaveBeenCalledWith(started.details);
  expect(fixture.observer.identified).toHaveBeenCalledWith("native");
  expect(fixture.observer.capabilities).toHaveBeenCalledWith(capabilities);
  expect(fixture.observer.progressed).toHaveBeenCalledWith(["progress"]);
  expect(fixture.observer.activity).toHaveBeenCalledWith(activity);
  expect(fixture.control.mock.calls.slice(0, 2)).toEqual([
    [{ kind: "ack", sequence: 3, digest: "digest" }],
    [{ kind: "read", after: 3, limit: 100 }],
  ]);
  fixture.session.detach();
});

it("imports and acknowledges journal records in order and completes confirmed closeout", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  const record = {
    sequence: 4,
    previousDigest: "previous",
    payload: "file",
    digest: "a".repeat(64),
  };
  fixture.importer.take.mockResolvedValue({ kind: "closed", result: CLOSED });
  fixture.control
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ records: [record] });
  await fixture.session.attach();
  expect(fixture.importer.take).toHaveBeenCalledWith(record);
  expect(fixture.control).toHaveBeenCalledWith({
    kind: "ack",
    sequence: 4,
    digest: record.digest,
  });
  await expect(fixture.session.terminated).resolves.toBeUndefined();
  await expect(fixture.session.close()).resolves.toEqual(CLOSED);
  expect(fixture.session.isClosed).toBe(true);
  expect(fixture.session.isDetached).toBe(true);
});

it("requires imported close history and retries close after a failed drain", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  await expect(fixture.session.close()).rejects.toThrow("not durably imported");
  expect(fixture.session.isClosed).toBe(false);
  expect(fixture.session.isClosing).toBe(true);
  fixture.session.detach();
});

it("sends steering and interrupt commands and rejects non-text prompts", async () => {
  const fixture = setup();
  await expect(
    fixture.session.steer([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]),
  ).resolves.toBe("injected");
  const command = fixture.control.mock.calls[0]?.[0];
  expect(command?.kind).toBe("steer");
  if (command?.kind !== "steer") throw new Error("Missing steer command");
  expect(command.prompt).toBe("first\nsecond");
  expect(command.commandId).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(
    fixture.session.steer([
      { type: "image", data: "x", mimeType: "image/png" },
    ]),
  ).resolves.toBe("failed");
  await expect(fixture.session.interrupt()).resolves.toBe(true);
  fixture.control.mockResolvedValueOnce({ interrupted: false });
  await expect(fixture.session.interrupt()).resolves.toBe(false);
  fixture.session.detach();
});

it("rebinds the observer and stops accepting new turns after detachment", async () => {
  const fixture = setup([{ kind: "identified", sessionId: "restored" }]);
  const nextObserver = { started: vi.fn(), identified: vi.fn() };
  await fixture.session.observe(new AbortController().signal, nextObserver);
  expect(nextObserver.identified).toHaveBeenCalledWith("restored");
  expect(fixture.observer.identified).not.toHaveBeenCalled();
  fixture.session.detach();
  await expect(
    fixture.session.next(stub({}), new AbortController().signal, nextObserver),
  ).rejects.toMatchObject({ code: "plan_session_unavailable" });
});
