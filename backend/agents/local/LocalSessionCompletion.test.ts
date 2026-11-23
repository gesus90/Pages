import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  createReattachedLocalSession,
  readLocalCompletion,
  readLocalMilestones,
} from "@/backend/agents/local/LocalSessionCompletion";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { Database } from "@/backend/database/Database";
import { AgentError } from "@/backend/error/AgentErrors";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { LocalSessionMutation } from "@/backend/agents/local/LocalSessionContracts";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const PLAN_ID = "plan";
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

const turn: Extract<LocalSessionMutation, { kind: "turn" }>["result"] = {
  output: "done",
  sessionId: null,
  failure: null,
  errorCode: null,
  endedAt: "2026-01-01T00:00:00.000Z",
  permissionDenials: 0,
  effective: {},
  events: [],
};
const turnMutation: LocalSessionMutation = {
  kind: "turn",
  attemptId: ATTEMPT_ID,
  turnId: ATTEMPT_ID,
  result: turn,
};
const identified: LocalSessionMutation = { kind: "identified", sessionId: "s" };

const input: AgentPlanExecutionInput = {
  agent: {
    connection: {
      isActive: true,
      id: "c",
      name: "n",
      provider: "codex_cli",
      hasApiKey: false,
      testModel: null,
      reasoningEffort: null,
      cliLoggedInAt: null,
      cliAccountLabel: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    model: "m",
    reasoningEffort: null,
  },
  userId: INSTANCE_ID,
  prompt: "p",
  directory: null,
};

let root = "";

beforeEach(async () => {
  const parent = pagesTempDirectory("local-session-completion-test");
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, "run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function openDatabase(withFiles: boolean): Database {
  const created: unknown = Reflect.construct(Database, [
    {},
    withFiles ? root : undefined,
  ]);
  if (!(created instanceof Database)) throw new Error("not a database");
  return created;
}

async function store(content: string): Promise<{
  readonly database: Database;
  readonly reference: string;
}> {
  const database = openDatabase(true);
  const reference = await database.agentFiles?.write(PLAN_ID, content);
  if (reference === undefined) throw new Error("no files");
  return { database, reference };
}

it("returns null when no result is stored", async () => {
  const result = vi.fn(async () => null);
  expect(
    await readLocalCompletion({ result }, openDatabase(false), "i", "t"),
  ).toBeNull();
  expect(result).toHaveBeenCalledWith("i", "t");
});

it("reads and validates a stored result", async () => {
  const { database, reference } = await store(JSON.stringify(turnMutation));
  expect(
    await readLocalCompletion(
      { result: async () => reference },
      database,
      "i",
      "t",
    ),
  ).toEqual(turnMutation);
});

it("rejects a stored result without payload storage", async () => {
  await expect(
    readLocalCompletion(
      { result: async () => "ref" },
      openDatabase(false),
      "i",
      "t",
    ),
  ).rejects.toThrow("not configured");
});

function entry(checkpointFile: string | null): LocalSessionEntry {
  return {
    instanceId: INSTANCE_ID,
    instanceKey: "k",
    runId: INSTANCE_ID,
    stepId: "step",
    attemptId: ATTEMPT_ID,
    manifestDigest: "",
    proof: null,
    acknowledgedSequence: 0,
    acknowledgedDigest: "",
    checkpointFile,
    releasedAt: null,
  };
}

it("returns no milestones for a missing entry or checkpoint", async () => {
  const database = openDatabase(false);
  expect(
    await readLocalMilestones(
      { list: async () => [] },
      database,
      "k",
      INSTANCE_ID,
    ),
  ).toEqual([]);
  expect(
    await readLocalMilestones(
      { list: async () => [entry(null)] },
      database,
      "k",
      INSTANCE_ID,
    ),
  ).toEqual([]);
});

it("reads the validated milestones of a checkpoint", async () => {
  const { database, reference } = await store(JSON.stringify([identified]));
  expect(
    await readLocalMilestones(
      { list: async () => [entry(reference)] },
      database,
      "k",
      INSTANCE_ID,
    ),
  ).toEqual([identified]);
});

it("rejects a checkpoint that is not a list", async () => {
  const { database, reference } = await store("{}");
  await expect(
    readLocalMilestones(
      { list: async () => [entry(reference)] },
      database,
      "k",
      INSTANCE_ID,
    ),
  ).rejects.toThrow("Invalid local session checkpoint");
});

function baseSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    turn: Promise.resolve({ ...turn, output: "live" }),
    close: vi.fn(async () => ({
      exit: null,
      endedAt: turn.endedAt,
      leftovers: 0,
      isConfirmed: true,
    })),
    ...overrides,
  };
}

it("replaces the live turn with a stored turn result", async () => {
  const wrapped = createReattachedLocalSession(baseSession(), turnMutation);
  expect((await wrapped.turn).output).toBe("done");
  expect(wrapped.isDurable).toBe(true);
});

it("keeps the live turn without a stored turn result", async () => {
  const terminated = Promise.resolve();
  const session = baseSession({ terminated });
  for (const result of [null, identified]) {
    const wrapped = createReattachedLocalSession(session, result);
    expect((await wrapped.turn).output).toBe("live");
    expect(wrapped.terminated).toBe(terminated);
  }
});

it("forwards the optional controls of the underlying session", async () => {
  const detach = vi.fn();
  const next = vi.fn(async () => turn);
  const steer = vi.fn(async () => "injected" as const);
  const interrupt = vi.fn(async () => true);
  const session = baseSession({
    detach,
    next,
    steer,
    interrupt,
    isDetached: true,
    isClosing: true,
  });
  const wrapped = createReattachedLocalSession(session, null);
  expect(wrapped.isDetached).toBe(true);
  expect(wrapped.isClosing).toBe(true);
  wrapped.detach?.();
  expect(detach).toHaveBeenCalledOnce();
  const controller = new AbortController();
  const observer = { started: vi.fn(), identified: vi.fn() };
  await wrapped.next?.(input, controller.signal, observer);
  expect(next).toHaveBeenCalledWith(input, controller.signal, observer);
  expect(await wrapped.steer?.([])).toBe("injected");
  expect(await wrapped.interrupt?.()).toBe(true);
  expect((await wrapped.close()).isConfirmed).toBe(true);
});

it("falls back when the underlying session lacks optional controls", async () => {
  const wrapped = createReattachedLocalSession(baseSession(), null);
  expect(wrapped.isDetached).toBe(false);
  expect(wrapped.isClosing).toBe(false);
  expect(wrapped.detach?.()).toBeUndefined();
  expect(await wrapped.steer?.([])).toBe("inactive");
  expect(await wrapped.interrupt?.()).toBe(false);
  expect(() =>
    wrapped.next?.(input, new AbortController().signal, {
      started: vi.fn(),
      identified: vi.fn(),
    }),
  ).toThrow(AgentError);
});
