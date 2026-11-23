import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logCaught: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaught,
}));

import {
  CallTransaction,
  afterCallCommit,
  beforeCallOpens,
  currentCall,
  detachFromCall,
  hasChangedRows,
  keepForCallCommit,
  runInCall,
  type CallTransactionHost,
} from "@/backend/database/CallTransaction";

import type { DatabaseTransaction } from "@/backend/database/Database";

const transaction = {
  query: vi.fn(),
  execute: vi.fn(),
} as unknown as DatabaseTransaction;

function host(
  options: { failure?: Error; ends?: boolean } = {},
): CallTransactionHost {
  return {
    runTransaction: (work) =>
      options.failure ? Promise.reject(options.failure) : work(transaction),
  };
}

beforeEach(() => mocks.logCaught.mockClear());

it("opens once and tracks its state", async () => {
  const owner = host();
  const call = new CallTransaction(owner);
  expect(call.isOpen).toBe(false);
  expect(call.isRunningOn(owner)).toBe(true);
  expect(call.isRunningOn(host())).toBe(false);
  const first = call.open();
  expect(call.open()).toBe(first);
  await expect(first).resolves.toBe(transaction);
  expect(call.isOpen).toBe(true);
  expect(call.nextSavepoint()).toBe("pages_call_1");
  expect(call.nextSavepoint()).toBe("pages_call_2");
  await call.end(null);
  expect(call.isOpen).toBe(false);
  expect(call.isRunningOn(owner)).toBe(false);
});

it("rejects the opening when the transaction cannot start", async () => {
  const call = new CallTransaction(host({ failure: new Error("busy") }));
  await expect(call.open()).rejects.toThrow("busy");
});

it("runs kept effects after the commit and reports failing ones", async () => {
  const call = new CallTransaction(host());
  await call.open();
  const order: string[] = [];
  call.defer(() => {
    order.push("a");
    return Promise.resolve();
  });
  call.defer(() => Promise.reject(new Error("effect")));
  call.defer(() => {
    order.push("c");
    return Promise.resolve();
  });
  await call.end(null);
  expect(order).toEqual(["a", "c"]);
  expect(mocks.logCaught).toHaveBeenCalledWith(
    "CallTransaction",
    expect.any(Error),
  );
});

it("drops effects on a rollback and reports a failing job", async () => {
  const effect = vi.fn(() => Promise.resolve());
  const quiet = new CallTransaction(host());
  await quiet.open();
  quiet.defer(effect);
  await quiet.end(new Error("fail"));
  expect(effect).not.toHaveBeenCalled();
  expect(mocks.logCaught).toHaveBeenCalledWith(
    "CallTransaction",
    expect.any(Error),
  );
  const never = new CallTransaction(host());
  await never.end(new Error("unopened"));
  await never.end(null);
});

it("hands effects of released nested frames on and drops rolled back ones", async () => {
  const call = new CallTransaction(host());
  await call.open();
  const kept = vi.fn(() => Promise.resolve());
  const dropped = vi.fn(() => Promise.resolve());
  call.beginNested();
  call.defer(kept);
  call.endNested(true);
  call.beginNested();
  call.defer(dropped);
  call.endNested(false);
  call.endNested(false);
  call.defer(() => Promise.resolve());
  call.endNested(true);
  await call.end(null);
  expect(kept).not.toHaveBeenCalled();
});

it("keeps effects of released frames for the commit", async () => {
  const call = new CallTransaction(host());
  await call.open();
  const kept = vi.fn(() => Promise.resolve());
  call.beginNested();
  call.defer(kept);
  call.endNested(true);
  await call.end(null);
  expect(kept).toHaveBeenCalled();
});

it("finds the running call of a host only", async () => {
  const owner = host();
  const call = new CallTransaction(owner);
  expect(currentCall(owner)).toBeNull();
  await runInCall(call, () => {
    expect(currentCall(owner)).toBe(call);
    expect(currentCall(host())).toBeNull();
    return detachFromCall(() => {
      expect(currentCall(owner)).toBeNull();
      return Promise.resolve();
    });
  });
});

it("keeps effects only for an open call", async () => {
  const effect = vi.fn(() => Promise.resolve());
  expect(keepForCallCommit(effect)).toBe(false);
  await afterCallCommit(effect);
  expect(effect).toHaveBeenCalledTimes(1);
  const call = new CallTransaction(host());
  await runInCall(call, async () => {
    expect(keepForCallCommit(effect)).toBe(false);
    await call.open();
    await afterCallCommit(effect);
  });
  expect(effect).toHaveBeenCalledTimes(1);
  await call.end(null);
  expect(effect).toHaveBeenCalledTimes(2);
});

it("runs bookkeeping outside of a call that is not open yet", async () => {
  const owner = host();
  const call = new CallTransaction(owner);
  await runInCall(call, async () => {
    await beforeCallOpens(() => {
      expect(currentCall(owner)).toBeNull();
      return Promise.resolve();
    });
    await call.open();
    await beforeCallOpens(() => {
      expect(currentCall(owner)).toBe(call);
      return Promise.resolve();
    });
  });
  await beforeCallOpens(() => Promise.resolve());
});

it("tells whether the transaction wrote", async () => {
  const query = vi.fn();
  query
    .mockResolvedValueOnce([[1]])
    .mockResolvedValueOnce([[0]])
    .mockResolvedValueOnce([]);
  const access = { query };
  await expect(hasChangedRows(access)).resolves.toBe(true);
  await expect(hasChangedRows(access)).resolves.toBe(false);
  await expect(hasChangedRows(access)).resolves.toBe(false);
});
