import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

import {
  installClaimHooks,
  mocks,
  JOB_ID,
  state,
  loadExecution,
  makeJob,
  readJson,
  writeJson,
  ageFolder,
} from "./runner-execution-claim-harness";

installClaimHooks();

async function seedJob(
  files: Record<string, unknown>,
  launch?: unknown,
): Promise<void> {
  await mkdir(state.folder, { recursive: true });
  for (const [name, value] of Object.entries(files))
    await writeJson(path.join(state.folder, name), value);
  if (launch !== undefined)
    await writeJson(
      path.join(state.directory, "ownership", `${JOB_ID}.json`),
      launch,
    );
}

const NAMESPACE_LAUNCH = {
  id: "launch-1",
  processId: 4242,
  identity: "boot:99",
  boundary: "pid_namespace",
};
const PUBLIC_LAUNCH = {
  id: "launch-1",
  processId: 4242,
  identity: "boot:99",
};

it("keeps a fresh queued job without a claim pending", async () => {
  await mkdir(state.folder, { recursive: true });
  const { observeJob } = await loadExecution();

  expect(await observeJob(state.directory, makeJob())).toBeNull();
  expect(mocks.cleanup).not.toHaveBeenCalled();
});

it("reports a stale queued job without a claim as lost after closeout", async () => {
  await mkdir(state.folder, { recursive: true });
  await ageFolder();
  mocks.cleanup.mockResolvedValue("failed");
  const { observeJob } = await loadExecution();

  expect(await observeJob(state.directory, makeJob())).toEqual({
    launch: null,
    status: "lost",
    result: {
      output: null,
      closeout: "failed",
      exitCode: null,
      signal: null,
      reason: "lost",
    },
  });
  expect(mocks.cleanup).toHaveBeenCalledWith(state.folder, JOB_ID);
});

it("reports a running job without a claim as lost at once", async () => {
  await mkdir(state.folder, { recursive: true });
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ status: "running" }),
  );

  expect(observed?.status).toBe("lost");
});

it("returns the stored history failure after the confirmed cursor only", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "history-failure.json": {
        status: "failed",
        historyFailure: "journal_unreadable",
        history: [{ sequence: 2 }, { sequence: 3 }],
      },
    },
    NAMESPACE_LAUNCH,
  );
  const { observeJob } = await loadExecution();

  expect(
    await observeJob(state.directory, makeJob({ historyCursor: 2 })),
  ).toEqual({
    launch: PUBLIC_LAUNCH,
    status: "failed",
    historyFailure: "journal_unreadable",
    history: [{ sequence: 3 }],
  });
});

it("pages events from the output journal of a running native worker", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "history/events/index.json": { sealed: false },
    },
    NAMESPACE_LAUNCH,
  );
  mocks.readJournalEvents.mockResolvedValue({
    events: [{ sequence: 5 }],
    length: 5,
  });
  mocks.cancellationFor.mockResolvedValue({ reason: "stop" });
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ outputJournalVersion: 2, historyCursor: 4 }),
  );

  expect(mocks.readJournalEvents).toHaveBeenCalledWith(
    path.join(state.folder, "history", "events"),
    { bound: true },
    4,
  );
  expect(observed).toEqual({
    launch: PUBLIC_LAUNCH,
    history: [{ sequence: 5 }],
    historyLength: 5,
    cancellation: { reason: "stop" },
    status: "running",
    result: { output: null, closeout: "pending" },
  });
});

it("starts the journal at the beginning when no cursor was confirmed", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "history/events/index.json": {},
    },
    NAMESPACE_LAUNCH,
  );
  mocks.readJournalEvents.mockResolvedValue({ events: [], length: 0 });
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ outputJournalVersion: 2 }),
  );

  expect(mocks.readJournalEvents.mock.calls[0][2]).toBe(0);
  expect(observed?.historyLength).toBe(0);
});

it("persists a history failure when a finished job has no output journal", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "result.json": { status: "completed", result: { closeout: "confirmed" } },
    },
    NAMESPACE_LAUNCH,
  );
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ outputJournalVersion: 2, status: "completed", historyCursor: 6 }),
  );

  expect(observed).toMatchObject({
    launch: PUBLIC_LAUNCH,
    status: "completed",
    historyFailure: "journal_unreadable",
    historyLength: 7,
    history: [{ sequence: 7, kind: "error", channel: "stderr" }],
    result: { closeout: "confirmed", reason: "storage" },
  });
  expect(
    await readJson(path.join(state.folder, "history-failure.json")),
  ).toEqual(expect.objectContaining({ historyLength: 7, status: "completed" }));
});

it("fails a non-terminal job whose journal cannot be read", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "history/events/index.json": {},
    },
    NAMESPACE_LAUNCH,
  );
  mocks.readJournalEvents.mockRejectedValue(new Error("integrity"));
  mocks.cleanup.mockResolvedValue("failed");
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ outputJournalVersion: 2, status: "running" }),
  );

  expect(observed).toMatchObject({
    status: "failed",
    historyLength: 1,
    result: {
      closeout: "failed",
      reason: "storage",
      storageError: "journal_write_failed",
    },
  });
});

it("observes a job without events yet when no journal index exists", async () => {
  await seedJob({ "claim.json": { jobId: JOB_ID } }, NAMESPACE_LAUNCH);
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ outputJournalVersion: 2, status: "running" }),
  );

  expect(observed?.history).toBeUndefined();
  expect(observed).not.toHaveProperty("historyLength");
  expect(mocks.readJournalEvents).not.toHaveBeenCalled();
});

it("reads the live history file of a version 1 job and defaults to empty", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "history.json": { events: [{ sequence: 1 }] },
      "progress.json": { output: "partial", closeout: "pending" },
    },
    NAMESPACE_LAUNCH,
  );
  const { observeJob } = await loadExecution();

  const withEvents = await observeJob(
    state.directory,
    makeJob({ liveHistoryVersion: 1, status: "running" }),
  );
  await rm(path.join(state.folder, "history.json"));
  const withoutFile = await observeJob(
    state.directory,
    makeJob({ liveHistoryVersion: 1, status: "running" }),
  );

  expect(withEvents).toMatchObject({
    history: [{ sequence: 1 }],
    result: { output: "partial" },
  });
  expect(withoutFile?.history).toEqual([]);
});

it("returns the terminal result with a fresh closeout for a finished worker", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "result.json": {
        status: "completed",
        result: { output: "done", closeout: "pending", exitCode: 0 },
      },
    },
    NAMESPACE_LAUNCH,
  );
  const { observeJob } = await loadExecution();

  expect(
    await observeJob(state.directory, makeJob({ status: "running" })),
  ).toEqual({
    launch: PUBLIC_LAUNCH,
    history: undefined,
    status: "completed",
    result: { output: "done", closeout: "confirmed", exitCode: 0 },
  });
  expect(mocks.cancelJob).not.toHaveBeenCalled();
});

it("keeps the recorded closeout and finalizes the cancellation of a worker that never started", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "result.json": {
        status: "interrupted",
        result: { closeout: "confirmed", reason: "cancelled" },
      },
    },
    { boundary: "not_started" },
  );
  mocks.cancellationFor.mockResolvedValue({ reason: "stop" });
  const { observeJob } = await loadExecution();
  const job = makeJob();

  const observed = await observeJob(state.directory, job);

  expect(observed).toMatchObject({
    launch: null,
    status: "interrupted",
    cancellation: { reason: "stop" },
    result: { closeout: "confirmed", reason: "cancelled" },
  });
  expect(mocks.cancelJob).toHaveBeenCalledWith(state.directory, {
    ...job,
    cancellation: { reason: "stop" },
  });
  expect(mocks.cleanup).not.toHaveBeenCalled();
});

it("does not finalize a cancellation whose closeout was not confirmed", async () => {
  await seedJob(
    {
      "claim.json": { jobId: JOB_ID },
      "result.json": {
        status: "interrupted",
        result: { closeout: "failed" },
      },
    },
    { boundary: "not_started" },
  );
  mocks.cancellationFor.mockResolvedValue({ reason: "stop" });
  const { observeJob } = await loadExecution();

  await observeJob(state.directory, makeJob());

  expect(mocks.cancelJob).not.toHaveBeenCalled();
});

it("keeps a fresh job without a launch pending", async () => {
  await seedJob({ "claim.json": { jobId: JOB_ID } });
  const { observeJob } = await loadExecution();

  expect(await observeJob(state.directory, makeJob())).toBeNull();
});

it("records a vanished worker as lost and stores the verdict", async () => {
  await seedJob({ "claim.json": { jobId: JOB_ID } }, NAMESPACE_LAUNCH);
  mocks.identity.mockResolvedValue("boot:other");
  const { observeJob } = await loadExecution();

  const observed = await observeJob(
    state.directory,
    makeJob({ status: "running" }),
  );

  expect(observed).toEqual({
    launch: PUBLIC_LAUNCH,
    history: undefined,
    status: "lost",
    result: {
      output: null,
      closeout: "confirmed",
      exitCode: null,
      signal: null,
      reason: "lost",
    },
  });
  expect(await readJson(path.join(state.folder, "result.json"))).toMatchObject({
    status: "lost",
  });
});

it("records a stale claim without any launch as lost", async () => {
  await seedJob({ "claim.json": { jobId: JOB_ID } });
  await ageFolder();
  const { observeJob } = await loadExecution();

  const observed = await observeJob(state.directory, makeJob());

  expect(observed).toMatchObject({ launch: null, status: "lost" });
});
