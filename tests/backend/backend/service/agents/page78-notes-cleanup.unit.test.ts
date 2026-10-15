import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentRunNotes } from "@/backend/service/agents/AgentRunNotes";
import { AgentRunNotesCleanup } from "@/backend/service/agents/AgentRunNotesCleanup";

import { notesFiles } from "./page78-notes-files";
import { notesRunFixture } from "./page78-notes-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";

vi.mock("node:fs/promises", async () =>
  (await import("./page78-notes-files")).notesFilesModule(),
);
const ROOT = "/notes/home/.pages/temp";
const WEEK = 7 * 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15"));
  notesFiles.reset();
});
afterEach(() => vi.useRealTimers());

async function cleanupFixture(): Promise<{
  readonly runs: Map<string, AgentPlanRun>;
  readonly notes: AgentRunNotes;
  readonly cleanup: AgentRunNotesCleanup;
  readonly processesGone: ReturnType<
    typeof vi.fn<(tags: readonly string[]) => Promise<boolean>>
  >;
  readonly directory: string;
}> {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const context = await notes.create(fixture.run, fixture.snapshot);
  if (!context) throw new Error("Missing notes");
  const runs = new Map([
    [fixture.run.id, { ...fixture.run, status: "failed" as const }],
  ]);
  const processesGone = vi.fn(async () => true);
  return {
    runs,
    notes,
    processesGone,
    directory: context.directory,
    cleanup: new AgentRunNotesCleanup({
      root: ROOT,
      notes,
      processesGone,
      runs: { find: async (id) => runs.get(id) ?? null },
    }),
  };
}

it("keeps recent orphans, removes only after seven days, and never follows file symlinks", async () => {
  const { cleanup, directory } = await cleanupFixture();
  notesFiles.put("/work/secret", "file", "retained");
  notesFiles.put(`${directory}/linked.md`, "link", "/work/secret");
  await vi.advanceTimersByTimeAsync(WEEK - 1);
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(false);
  expect(notesFiles.entries.get("/work/secret")?.content).toBe("retained");
});

it("protects active, paused, unknown, unreadable and still-running process states", async () => {
  const { cleanup, directory, runs, processesGone } = await cleanupFixture();
  const stored = runs.get("run");
  if (!stored) throw new Error("Missing run");
  await vi.advanceTimersByTimeAsync(WEEK * 2);
  for (const status of ["running", "paused"] as const) {
    runs.set("run", { ...stored, status });
    await cleanup.runOnce();
    expect(notesFiles.entries.has(directory)).toBe(true);
  }
  runs.delete("run");
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
  runs.set("run", stored);
  processesGone.mockResolvedValue(false);
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
});

it("ignores symlink directories and refuses a foreign or concurrently changed run", async () => {
  const { cleanup, directory, runs, processesGone } = await cleanupFixture();
  const stored = runs.get("run");
  if (!stored) throw new Error("Missing run");
  notesFiles.put(`${ROOT}/plan/alias`, "link", directory);
  await vi.advanceTimersByTimeAsync(WEEK * 2);
  runs.set("run", { ...stored, planId: "foreign" });
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
  runs.set("run", stored);
  processesGone.mockImplementation(async () => {
    runs.set("run", { ...stored, status: "paused" });
    return true;
  });
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
  expect(notesFiles.entries.has(`${ROOT}/plan/alias`)).toBe(true);
});

it("logs cleanup failures and drains the periodic worker on shutdown", async () => {
  const { cleanup, notes } = await cleanupFixture();
  vi.spyOn(notes, "discard").mockRejectedValue(new Error("disk unavailable"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanup.start();
  await vi.advanceTimersByTimeAsync(WEEK);
  expect(error).toHaveBeenCalled();
  await cleanup.shutdown();
  error.mockClear();
  await vi.advanceTimersByTimeAsync(WEEK);
  expect(error).not.toHaveBeenCalled();
});

it("retains durable pause evidence when startup recovery already marked the old run as failed", async () => {
  const { cleanup, notes, directory } = await cleanupFixture();
  const context = { root: ROOT, directory };
  await notes.setPaused(context, { isPaused: true });
  await vi.advanceTimersByTimeAsync(WEEK * 2);
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(true);
  expect(notesFiles.entries.get(`${directory}.paused`)?.mode).toBe(0o600);
  await notes.setPaused(context, { isPaused: false });
  await cleanup.runOnce();
  expect(notesFiles.entries.has(directory)).toBe(false);
});

it("limits one plan to a hundred candidates and reaches the remaining history on the next sweep", async () => {
  const { cleanup, runs, directory } = await cleanupFixture();
  const stored = runs.get("run");
  if (!stored) throw new Error("Missing run");
  for (let index = 0; index < 105; index++) {
    const id = `run-${index}`;
    notesFiles.put(`${ROOT}/plan/${id}`, "directory");
    runs.set(id, { ...stored, id });
  }
  await vi.advanceTimersByTimeAsync(WEEK * 2);
  await cleanup.runOnce();
  const remaining = (): number =>
    [...notesFiles.entries.keys()].filter(
      (filename) =>
        filename.startsWith(`${ROOT}/plan/`) && !filename.endsWith(".md"),
    ).length;
  expect(remaining()).toBe(6);
  await cleanup.runOnce();
  expect(remaining()).toBe(0);
  expect(notesFiles.entries.has(directory)).toBe(false);
});
