import { expect, it, vi } from "vitest";

import {
  AgentRunFailureIndexer,
  buildFailureIndexEntry,
  indexRunFailures,
} from "@/backend/service/agents/diagnosis/AgentRunFailureIndexer";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  AgentRunFailureRepository,
  RunToIndex,
} from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";

const stored = partial<RunToIndex>({
  runId: "run",
  revision: 2,
  planId: "plan",
  projectId: "project",
  startedById: "user",
  run: null,
});

it("indexes a damaged run without inventing failure or end details", () => {
  expect(buildFailureIndexEntry(stored)).toMatchObject({
    runId: "run",
    planName: "plan",
    endedAt: null,
    failedStepId: null,
    errorClass: null,
    failures: [],
  });
});

it("derives an ended run's last step time and leaves active runs open", () => {
  const run = {
    id: "run",
    planName: "Plan",
    status: "succeeded",
    endedAt: null,
    steps: [
      {
        id: "step",
        status: "succeeded",
        script: { endedAt: "2026-01-02", startedAt: "2026-01-01" },
      },
    ],
  };
  expect(
    buildFailureIndexEntry(partial<RunToIndex>({ ...stored, run })).endedAt,
  ).toBe("2026-01-02");
  expect(
    buildFailureIndexEntry(
      partial<RunToIndex>({ ...stored, run: { ...run, status: "running" } }),
    ).endedAt,
  ).toBeNull();
});

it("indexes existing runs and ignores missing ones", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(stored)
    .mockResolvedValueOnce(null);
  const replace = vi.fn();
  await indexRunFailures({ load, replace }, "run");
  await indexRunFailures({ load, replace }, "missing");
  expect(replace).toHaveBeenCalledOnce();
});

it("coalesces overlapping refreshes and stops after the last short batch", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = vi.fn().mockImplementationOnce(async () => {
    await gate;
    return ["run"];
  });
  const load = vi.fn(async () => stored);
  const replace = vi.fn();
  const failures = partial<AgentRunFailureRepository>({
    pending,
    load,
    replace,
  });
  const indexer = new AgentRunFailureIndexer(
    failures,
    {
      read: async () => ({ logRetentionDays: 2, stallMinutes: 5, revision: 1 }),
    },
    () => Date.parse("2026-01-03T00:00:00Z"),
  );
  const first = indexer.refresh();
  const second = indexer.refresh();
  release();
  await Promise.all([first, second]);
  expect(pending).toHaveBeenCalledOnce();
  expect(pending).toHaveBeenCalledWith("2026-01-01T00:00:00.000Z", 100);
  expect(replace).toHaveBeenCalledOnce();
});
