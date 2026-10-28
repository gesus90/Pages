import { beforeEach, expect, it, vi } from "vitest";

import {
  isLeaseActive,
  releaseJob,
} from "../../../../../scripts/runner/admission.mjs";

import type * as FileSystem from "node:fs/promises";

const journal = vi.hoisted(() => ({
  identity: vi.fn<(processId: number) => Promise<string | null>>(
    async () => "live",
  ),
  readRecord: vi.fn<(path: string) => Promise<unknown>>(async () => null),
  store: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock("../../../../../scripts/runner/journal.mjs", () => journal);
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return { ...original, rm: journal.remove };
});

const LEASE = {
  folder: "/synthetic/job",
  createdAt: 0,
  processId: 123,
  identity: "live",
};
const JOB = {
  jobId: "job",
  sessionId: "session",
  plan: { attemptId: "attempt" },
};

beforeEach(() => {
  journal.readRecord.mockReset().mockResolvedValue(null);
  journal.identity.mockReset().mockResolvedValue("live");
  journal.remove.mockClear();
});

it("retains an old reservation while its owner is alive and no closeout exists", async () => {
  journal.readRecord.mockResolvedValue(null);
  journal.identity.mockResolvedValue("live");

  await expect(isLeaseActive(LEASE)).resolves.toBe(true);
});

it("retains an unconfirmed reservation when the original owner is gone", async () => {
  journal.readRecord.mockResolvedValue(null);
  journal.identity.mockResolvedValue(null);

  await expect(isLeaseActive(LEASE)).resolves.toBe(true);
});

it("keeps a live worker reserved even if a confirmed result was recorded", async () => {
  journal.readRecord.mockResolvedValueOnce({
    processId: 456,
    identity: "live",
  });
  journal.identity.mockResolvedValue("live");

  await expect(isLeaseActive(LEASE)).resolves.toBe(true);
});

it("releases only after the worker is gone and closeout is confirmed", async () => {
  journal.readRecord
    .mockResolvedValueOnce({ processId: 456, identity: "old" })
    .mockResolvedValueOnce({ result: { closeout: "confirmed" } });
  journal.identity.mockResolvedValue(null);

  await expect(isLeaseActive(LEASE)).resolves.toBe(false);
});

it("retains a reservation after a failed closeout", async () => {
  journal.readRecord
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ result: { closeout: "failed" } });

  await expect(isLeaseActive(LEASE)).resolves.toBe(true);
});

it("reports an unreadable journal instead of treating it as a released lease", async () => {
  journal.readRecord.mockRejectedValue(new Error("journal unavailable"));

  await expect(isLeaseActive(LEASE)).rejects.toThrow("journal unavailable");
});

it("does not remove a matching lease while its worker still lives", async () => {
  journal.readRecord
    .mockResolvedValueOnce({ ...LEASE, ...JOB, attemptId: JOB.plan.attemptId })
    .mockResolvedValueOnce({ processId: 456, identity: "live" });

  await releaseJob(JOB);

  expect(journal.remove).not.toHaveBeenCalled();
});

it("removes a matching lease after a confirmed closeout and worker exit", async () => {
  journal.readRecord
    .mockResolvedValueOnce({ ...LEASE, ...JOB, attemptId: JOB.plan.attemptId })
    .mockResolvedValueOnce({ processId: 456, identity: "old" })
    .mockResolvedValueOnce({ result: { closeout: "confirmed" } });
  journal.identity.mockResolvedValue(null);

  await releaseJob(JOB);

  expect(journal.remove).toHaveBeenCalledOnce();
});
