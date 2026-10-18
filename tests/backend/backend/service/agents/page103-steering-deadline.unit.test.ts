import { afterEach, expect, it, vi } from "vitest";

import { ScheduledAcpSession } from "@/backend/service/agents/resources/ScheduledAcpSession";
import { CHAT_REQUEST_TIMEOUT_MS } from "@/backend/service/chat/ChatExecutionLimits";

import {
  completedTurn,
  deferred,
  nativeSession,
} from "./page81-resource-fixture";
import { ASSIGNMENT } from "../chat/page48-chat-fixture";

import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";

afterEach(() => vi.useRealTimers());

it("does not retire an adapter-started Pica follow-up after the five-minute idle timeout", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const transition = vi.fn(async () => undefined);
  const session = new ScheduledAcpSession(
    { ...native, steer: async () => "startedNewTurn" },
    { idleTimeout: 300000, transition, finish: async () => true },
  );
  await session.turn;
  expect(await session.steer([])).toBe("startedNewTurn");
  expect(transition).toHaveBeenLastCalledWith("running");
  await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS);
  expect(native.close).not.toHaveBeenCalled();
  await session.close();
  expect(native.close).toHaveBeenCalledOnce();
});

it("holds idle expiry while a steer is in flight but restores it when no adapter turn starts", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const response = deferred<AcpSteerOutcome>();
  const session = new ScheduledAcpSession(
    { ...native, steer: () => response.promise },
    {
      idleTimeout: 300000,
      transition: async () => undefined,
      finish: async () => true,
    },
  );
  await session.turn;
  const steered = session.steer([]);
  await vi.advanceTimersByTimeAsync(300001);
  expect(native.close).not.toHaveBeenCalled();
  response.resolve("promptRequired");
  await steered;
  await vi.advanceTimersByTimeAsync(300000);
  expect(native.close).toHaveBeenCalledOnce();
});

it("does not arm idle retirement when the original prompt settles after the adapter started its follow-up", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const first = deferred<ReturnType<typeof completedTurn>>();
  const session = new ScheduledAcpSession(
    { ...native, turn: first.promise, steer: async () => "startedNewTurn" },
    {
      idleTimeout: 300000,
      transition: async () => undefined,
      finish: async () => true,
    },
  );
  await session.steer([]);
  first.resolve(completedTurn());
  await session.turn;
  await vi.advanceTimersByTimeAsync(300001);
  expect(native.close).not.toHaveBeenCalled();
  await session.close();
});

it("returns to the normal idle deadline after an adapter follow-up is continued by an explicit prompt", async () => {
  vi.useFakeTimers();
  const native = nativeSession();
  const next = deferred<ReturnType<typeof completedTurn>>();
  native.next.mockImplementation(() => next.promise);
  const session = new ScheduledAcpSession(
    { ...native, steer: async () => "startedNewTurn" },
    {
      idleTimeout: 300000,
      transition: async () => undefined,
      finish: async () => true,
    },
  );
  await session.turn;
  await session.steer([]);
  const pending = session.next(
    {
      agent: ASSIGNMENT,
      userId: "owner",
      prompt: "Next",
      directory: "/synthetic",
    },
    new AbortController().signal,
    { started: () => undefined, identified: () => undefined },
  );
  await vi.advanceTimersByTimeAsync(300001);
  expect(native.close).not.toHaveBeenCalled();
  next.resolve(completedTurn());
  await pending;
  await vi.advanceTimersByTimeAsync(300000);
  expect(native.close).toHaveBeenCalledOnce();
});
