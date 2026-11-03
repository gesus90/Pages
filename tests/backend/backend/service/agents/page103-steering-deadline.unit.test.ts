import { afterEach, expect, it, vi } from "vitest";

import { ScheduledAcpSession } from "@/backend/service/agents/resources/ScheduledAcpSession";

import {
  completedTurn,
  deferred,
  nativeSession,
} from "./page81-resource-fixture";
import { ASSIGNMENT } from "../chat/page48-chat-fixture";

import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";

/** Longer than any deadline a session could be measured against. */
const LONG_IDLE_MS = 24 * 60 * 60_000;

afterEach(() => vi.useRealTimers());

function lifecycle(
  transition: (state: string) => Promise<void> = async () => undefined,
): ConstructorParameters<typeof ScheduledAcpSession>[1] {
  return { transition, finish: async () => true };
}

it("keeps an adapter-started Pica follow-up running until its owner closes the session", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const transition = vi.fn(async () => undefined);
  const session = new ScheduledAcpSession(
    { ...native, steer: async () => "startedNewTurn" },
    lifecycle(transition),
  );
  await session.turn;
  expect(await session.steer([])).toBe("startedNewTurn");
  expect(transition).toHaveBeenLastCalledWith("running");
  await vi.advanceTimersByTimeAsync(LONG_IDLE_MS);
  expect(native.close).not.toHaveBeenCalled();
  await session.close();
  expect(native.close).toHaveBeenCalledOnce();
});

it("never closes a session because it waits, also after a steer that started no turn", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const response = deferred<AcpSteerOutcome>();
  const session = new ScheduledAcpSession(
    { ...native, steer: () => response.promise },
    lifecycle(),
  );
  await session.turn;
  await vi.advanceTimersByTimeAsync(LONG_IDLE_MS);
  const steered = session.steer([]);
  response.resolve("promptRequired");
  await steered;
  await vi.advanceTimersByTimeAsync(LONG_IDLE_MS);
  expect(native.close).not.toHaveBeenCalled();
  expect(session.isClosing).toBe(false);
});

it("reports no idle state when the original prompt settles after the adapter started its follow-up", async () => {
  const native = nativeSession();
  const first = deferred<ReturnType<typeof completedTurn>>();
  const transition = vi.fn(async () => undefined);
  const session = new ScheduledAcpSession(
    { ...native, turn: first.promise, steer: async () => "startedNewTurn" },
    lifecycle(transition),
  );
  await session.steer([]);
  first.resolve(completedTurn());
  await session.turn;
  expect(transition).not.toHaveBeenCalledWith("idle");
  await session.close();
});

it("continues a session with its next prompt however long it waited", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const session = new ScheduledAcpSession(native, lifecycle());
  await session.turn;
  await vi.advanceTimersByTimeAsync(LONG_IDLE_MS);
  await session.next(
    {
      agent: ASSIGNMENT,
      userId: "owner",
      prompt: "Next",
      directory: "/synthetic",
    },
    new AbortController().signal,
    { started: () => undefined, identified: () => undefined },
  );
  expect(native.next).toHaveBeenCalledOnce();
  expect(native.close).not.toHaveBeenCalled();
});
