import { beforeEach, expect, it, vi } from "vitest";

import { AgentRunNotes } from "@/backend/service/agents/AgentRunNotes";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { createSessionRecord } from "@/backend/service/agents/AgentPlanSessionRecords";

import { notesFiles } from "./page78-notes-files";
import { notesRunFixture } from "./page78-notes-fixture";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

vi.mock("node:fs/promises", async () =>
  (await import("./page78-notes-files")).notesFilesModule(),
);

const ROOT = "/notes/home/.pages/temp";
beforeEach(() => notesFiles.reset());

it("automatically creates private plan/run and node files once before any node starts", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const snapshot = {
    ...fixture.snapshot,
    steps: [
      fixture.step,
      { ...fixture.step, step: { ...fixture.step.step, id: "another-node" } },
    ],
  };
  const context = await notes.create(fixture.run, snapshot);
  expect(context).toEqual({ root: ROOT, directory: `${ROOT}/plan/run` });
  expect(notesFiles.entries.get(`${ROOT}/plan/run`)?.mode).toBe(0o700);
  expect(notesFiles.entries.get(`${ROOT}/plan/run/step.md`)?.mode).toBe(0o600);
  expect(notesFiles.entries.get(`${ROOT}/plan/run/another-node.md`)?.mode).toBe(
    0o600,
  );
  await expect(notes.create(fixture.run, snapshot)).rejects.toMatchObject({
    code: "EEXIST",
  });
  const input = await fixture.start.prepare(
    fixture.run,
    snapshot,
    fixture.step,
    context ?? undefined,
  );
  expect(input.input.prompt).toContain(`${ROOT}/plan/run/step.md`);
  expect(input.input.prompt).toContain(`Notes: ${ROOT}/plan/run`);
  await notesFiles.writeFile(`${ROOT}/plan/run/step.md`, "Knowledge");
  await fixture.start.prepare(
    fixture.run,
    snapshot,
    fixture.step,
    context ?? undefined,
  );
  expect(notesFiles.entries.get(`${ROOT}/plan/run/step.md`)?.content).toBe(
    "Knowledge",
  );
});

it("creates nothing without usable bubblewrap; a token is rejected with its node id", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => false });
  await expect(
    notes.create(fixture.run, fixture.snapshot),
  ).rejects.toMatchObject({
    issues: [{ nodeId: "step", reason: "notesUnavailable" }],
  });
  const plain = {
    ...fixture.snapshot,
    steps: [
      {
        ...fixture.step,
        template: { ...fixture.step.template, markdown: "No notes requested" },
      },
    ],
  };
  await expect(notes.create(fixture.run, plain)).resolves.toBeNull();
  expect(notesFiles.writes).toEqual([]);
});

it.each([
  "openai",
  "openrouter",
  "anthropic",
  "zai",
  "google_ai_studio",
] as const)("rejects %s file access before any write", async (provider) => {
  const fixture = await notesRunFixture(provider);
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  await expect(notes.validate(fixture.snapshot)).rejects.toMatchObject({
    issues: [{ nodeId: "step", reason: "notesApi" }],
  });
  await expect(
    fixture.start.prepare(fixture.run, fixture.snapshot, fixture.step),
  ).rejects.toMatchObject({ code: "plan_notes_api" });
  expect(notesFiles.writes).toEqual([]);
});

it("keeps suitable mixed plans and also validates built-ins in extra node instructions", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const api = {
    ...fixture.step,
    provider: "openai" as const,
    step: { ...fixture.step.step, id: "api" },
    template: { ...fixture.step.template, markdown: "Summarize" },
  };
  await expect(
    notes.validate({ ...fixture.snapshot, steps: [fixture.step, api] }),
  ).resolves.toBe(true);
  await expect(
    notes.validate({
      ...fixture.snapshot,
      steps: [
        { ...api, step: { ...api.step, instruction: "Read {{@run.notes}}" } },
      ],
    }),
  ).rejects.toMatchObject({ issues: [{ nodeId: "api", reason: "notesApi" }] });
});

it("rolls back partially created files and never adopts a symlink, foreign root or unsafe id", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  notesFiles.failFile = "step.md";
  await expect(
    notes.create(fixture.run, fixture.snapshot),
  ).rejects.toMatchObject({ code: "ENOSPC" });
  expect(notesFiles.entries.has(`${ROOT}/plan/run`)).toBe(false);
  notesFiles.failFile = null;
  notesFiles.put(ROOT, "link", "/work");
  await expect(notes.create(fixture.run, fixture.snapshot)).rejects.toThrow();
  notesFiles.put(ROOT, "directory", "", { mode: 0o777 });
  await expect(
    notes.create(fixture.run, fixture.snapshot),
  ).rejects.toMatchObject({ code: "plan_notes_path_invalid" });
  notesFiles.put(ROOT, "directory");
  await expect(
    notes.create({ ...fixture.run, id: "../foreign" }, fixture.snapshot),
  ).rejects.toMatchObject({ code: "plan_notes_path_invalid" });
});

it("rejects child, parent and symlink workspaces before creating notes", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  notesFiles.put("/notes/home/.pages", "directory");
  notesFiles.put(ROOT, "directory");
  notesFiles.put(`${ROOT}/workspace`, "directory");
  notesFiles.put("/alias", "link", ROOT);
  for (const directory of ["/notes/home", ROOT, `${ROOT}/workspace`, "/alias"])
    await expect(
      notes.validate({
        ...fixture.snapshot,
        steps: [
          {
            ...fixture.step,
            prepared: {
              ...fixture.step.prepared,
              workspace: {
                ...fixture.step.prepared.workspace,
                path: directory,
              },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "plan_notes_path_invalid" });
  expect(notesFiles.writes).toEqual([]);
});

it("retains paused and uncertain runs and removes only terminal notes with settled processes", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const context = await notes.create(fixture.run, fixture.snapshot);
  if (!context) throw new Error("Missing notes");
  await notes.complete({ ...fixture.run, status: "paused" }, context);
  expect(notesFiles.entries.has(context.directory)).toBe(true);
  await notes.complete(fixture.run, context);
  expect(notesFiles.entries.has(context.directory)).toBe(true);
  await notes.complete({ ...fixture.run, status: "succeeded" }, context);
  expect(notesFiles.entries.has(context.directory)).toBe(false);
});

it("cleans a node refused before spawn while retaining an uncertain started process", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const context = await notes.create(fixture.run, fixture.snapshot);
  if (!context) throw new Error("Missing notes");
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
    context,
  );
  const session = {
    ...createSessionRecord({
      instanceId: "session",
      prepared,
      contract: null,
      usesMcp: false,
    }),
    closeout: "not_needed" as const,
  };
  const result = {
    id: "step",
    name: "Agent",
    status: "failed" as const,
    cancellation: "none" as const,
    isBlocked: false,
    output: null,
    error: "cli_not_logged_in",
    session,
  };
  const run = { ...fixture.run, status: "failed" as const, steps: [result] };
  await notes.complete(
    {
      ...run,
      steps: [
        {
          ...result,
          session: { ...session, startedAt: "2026-10-15", processId: 42 },
        },
      ],
    },
    context,
  );
  expect(notesFiles.entries.has(context.directory)).toBe(true);
  await notes.complete(run, context);
  expect(notesFiles.entries.has(context.directory)).toBe(false);
});

it("cleans a failed persistence start before a step can run", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const run = vi.fn();
  const engine = new AgentPlanRunEngine({
    notes,
    start: fixture.start,
    runs: {
      create: async () => {
        throw new Error("storage failed");
      },
      insert: vi.fn(),
      update: vi.fn(),
      find: vi.fn(),
    },
    steps: { run, closeGroups: vi.fn() },
  });
  await expect(engine.start("owner", fixture.snapshot)).rejects.toThrow(
    "storage failed",
  );
  expect(run).not.toHaveBeenCalled();
  expect(
    [...notesFiles.entries.keys()].filter((filename) =>
      filename.endsWith(".md"),
    ),
  ).toEqual([]);
});

it("also rolls back notes when the first scheduler write fails after run creation", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const run = vi.fn();
  const update = vi
    .fn()
    .mockRejectedValueOnce(new Error("first progress write failed"));
  const engine = new AgentPlanRunEngine({
    notes,
    start: fixture.start,
    runs: { create: vi.fn(), insert: vi.fn(), update, find: vi.fn() },
    steps: { run, closeGroups: vi.fn() },
  });
  await expect(engine.start("owner", fixture.snapshot)).rejects.toThrow(
    "first progress write failed",
  );
  expect(run).not.toHaveBeenCalled();
  expect(
    [...notesFiles.entries.keys()].filter((filename) =>
      filename.endsWith(".md"),
    ),
  ).toEqual([]);
});

it("keeps a paused engine's files until its last process promise settles after cancellation", async () => {
  const fixture = await notesRunFixture();
  const notes = new AgentRunNotes(ROOT, { isAvailable: async () => true });
  const views = new Map<string, AgentPlanRun>();
  let finish: ((result: Partial<AgentPlanStepResult>) => void) | undefined;
  const run = vi.fn(
    () =>
      new Promise<Partial<AgentPlanStepResult>>((resolve) => {
        finish = resolve;
      }),
  );
  const engine = new AgentPlanRunEngine({
    notes,
    start: fixture.start,
    runs: {
      create: async (view) => {
        views.set(view.id, view);
      },
      insert: vi.fn(),
      update: async (view) => {
        views.set(view.id, view);
      },
      find: async (id) => views.get(id) ?? null,
    },
    steps: { run, closeGroups: vi.fn() },
  });
  const view = await engine.start("owner", fixture.snapshot);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  const directory = `${ROOT}/plan/${view.id}`;
  await engine.pause(view.id);
  expect(notesFiles.entries.has(directory)).toBe(true);
  await engine.resume(view.id);
  await engine.stop(view.id);
  expect(notesFiles.entries.has(directory)).toBe(true);
  finish?.({ status: "cancelled", cancellation: "confirmed" });
  await vi.waitFor(() => expect(notesFiles.entries.has(directory)).toBe(false));
  expect(views.get(view.id)?.status).toBe("cancelled");
});
