import { beforeEach, expect, it, vi } from "vitest";

import { AgentRunNotes } from "@/backend/service/agents/AgentRunNotes";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

import { notesRunFixture } from "./page78-notes-fixture";
import { notesFiles } from "./page78-notes-files";
import { GROUP_REPORT } from "./page73-group-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanSessionInput,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

vi.mock("node:fs/promises", async () =>
  (await import("./page78-notes-files")).notesFilesModule(),
);
beforeEach(() => notesFiles.reset());

async function runSharingPlan(
  act: (input: AgentPlanSessionInput) => Promise<void>,
  isParallel = false,
): Promise<void> {
  const fixture = await notesRunFixture();
  const steps = ["first", "second"].map((id) => ({
    ...fixture.step,
    step: { ...fixture.step.step, id, instruction: id },
  }));
  const snapshot = {
    ...fixture.snapshot,
    steps,
    plan: {
      ...fixture.snapshot.plan,
      nodes: steps.map((entry) => entry.step),
      edges: isParallel
        ? []
        : [
            {
              from: "first",
              to: "second",
              fromPort: "flow-out",
              toPort: "flow-in",
            },
          ],
    },
  };
  const views = new Map<string, AgentPlanRun>();
  const runner = new AgentPlanStepRunner({
    start: fixture.start,
    tasks: { checklist: vi.fn() },
    access: { grant: async () => null, revoke: async () => 0 },
    execution: {
      run: vi.fn(),
      open: async (input, signal, observer) => {
        signal.throwIfAborted();
        observer.started({
          mode: "interactive",
          processId: null,
          startedAt: new Date().toISOString(),
          arguments: [],
          unattended: "synthetic CLI boundary",
        });
        const turn = act(input).then((): PlanSessionTurn => ({
          output: GROUP_REPORT,
          sessionId: null,
          failure: null,
          errorCode: null,
          endedAt: new Date().toISOString(),
          permissionDenials: 0,
          effective: {},
          events: [],
        }));
        return {
          turn,
          close: async () => ({
            exit: { code: 0, signal: null },
            endedAt: new Date().toISOString(),
            leftovers: 0,
            isConfirmed: true,
          }),
        };
      },
    },
  });
  const engine = new AgentPlanRunEngine({
    start: fixture.start,
    steps: runner,
    notes: new AgentRunNotes("/notes/home/.pages/temp", {
      isAvailable: async () => true,
    }),
    runs: {
      create: async (view) => {
        views.set(view.id, view);
      },
      insert: vi.fn(),
      find: async (id) => views.get(id) ?? null,
      update: async (view) => {
        views.set(view.id, view);
      },
    },
  });
  const run = await engine.start("owner", snapshot);
  await vi.waitFor(() =>
    expect(views.get(run.id)?.status, JSON.stringify(views.get(run.id))).toBe(
      "succeeded",
    ),
  );
  await engine.shutdown();
}

it("delivers the first CLI node's file to the second through the real prompt and scheduler path over a mocked CLI", async () => {
  let read = "";
  await runSharingPlan(async (input) => {
    const directory = input.notes?.directory;
    if (!directory) throw new Error("Missing notes capability");
    if (input.prompt.includes(`${directory}/first.md`))
      await notesFiles.writeFile(
        `${directory}/first.md`,
        "First node's finding",
      );
    else {
      read = notesFiles.entries.get(`${directory}/first.md`)?.content ?? "";
      await notesFiles.writeFile(`${directory}/second.md`, `Received: ${read}`);
    }
  });
  expect(read).toBe("First node's finding");
});

it("gives parallel nodes distinct own files and a shared view, with writes governed by the documented protocol", async () => {
  let release: (() => void) | undefined;
  const written = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  const reads: string[] = [];
  await runSharingPlan(async (input) => {
    const directory = input.notes?.directory;
    if (!directory) throw new Error("Missing notes capability");
    const own = input.prompt.includes(`${directory}/first.md`)
      ? "first"
      : "second";
    await notesFiles.writeFile(`${directory}/${own}.md`, own);
    count++;
    if (count === 2) release?.();
    await written;
    reads.push(
      notesFiles.entries.get(
        `${directory}/${own === "first" ? "second" : "first"}.md`,
      )?.content ?? "",
    );
  }, true);
  expect(reads.sort()).toEqual(["first", "second"]);
});
