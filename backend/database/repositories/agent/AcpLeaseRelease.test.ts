import { beforeEach, expect, it, vi, type Mock } from "vitest";

import { logEvent } from "@/backend/logging/Logger";

import { releaseAcpLease } from "./AcpLeaseRelease";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

interface Fixture {
  readonly transaction: DatabaseTransaction;
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly effects: (() => Promise<void>)[];
}

function fixtureOf(
  answers: DatabaseValue[][][],
  hasCommitHook = true,
): Fixture {
  const effects: (() => Promise<void>)[] = [];
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => answers.shift() ?? [],
  );
  const transaction: DatabaseTransaction = {
    execute: vi.fn(async () => {}),
    query,
    ...(hasCommitHook
      ? { onCommit: (effect: () => Promise<void>) => void effects.push(effect) }
      : {}),
  };
  return { transaction, query, effects };
}

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

it("releases the lease and logs only after the commit", async () => {
  const { transaction, query, effects } = fixtureOf([[["run-1"]]]);
  await expect(
    releaseAcpLease(transaction, {
      instanceId: "i1",
      isUncertain: true,
      runId: "run-1",
      reason: "process_end_confirmed",
    }),
  ).resolves.toBe("released");
  expect(query.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    is_uncertain: true,
    run_id: "run-1",
  });
  expect(logEvent).not.toHaveBeenCalled();
  await effects[0]?.();
  expect(vi.mocked(logEvent).mock.calls[0]?.[0].metadata).toEqual({
    runId: "run-1",
    lock: "i1",
    reason: "process_end_confirmed",
  });
});

it("logs a missing run identifier as null", async () => {
  const { transaction, query, effects } = fixtureOf([[[]]]);
  query.mockResolvedValueOnce([[]]);
  await releaseAcpLease(transaction, {
    instanceId: "i1",
    isUncertain: false,
    reason: "owner_released",
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({ run_id: null });
  await effects[0]?.();
  expect(vi.mocked(logEvent).mock.calls[0]?.[0].metadata).toMatchObject({
    runId: null,
  });
});

it("releases without a commit hook", async () => {
  const { transaction } = fixtureOf([[["run-1"]]], false);
  await expect(
    releaseAcpLease(transaction, {
      instanceId: "i1",
      isUncertain: false,
      reason: "owner_released",
    }),
  ).resolves.toBe("released");
});

it("reports a changed lease that is still present", async () => {
  const { transaction } = fixtureOf([[], [["i1"]]]);
  await expect(
    releaseAcpLease(transaction, {
      instanceId: "i1",
      isUncertain: true,
      reason: "process_end_confirmed",
    }),
  ).resolves.toBe("changed");
});

it("reports an absent lease", async () => {
  const { transaction } = fixtureOf([[], []]);
  await expect(
    releaseAcpLease(transaction, {
      instanceId: "i1",
      isUncertain: false,
      reason: "owner_released",
    }),
  ).resolves.toBe("absent");
});
