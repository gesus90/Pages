import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  createLocalSessionLaunch,
  localSessionDirectory,
  readCurrentLocalLaunch,
  readLocalSessionMilestones,
  readSharedLocalLaunch,
} from "@/backend/agents/local/LocalSessionLaunch";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { Database } from "@/backend/database/Database";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  LocalOwnerManifest,
  LocalSessionLaunch,
  LocalSessionMutation,
} from "@/backend/agents/local/LocalSessionContracts";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

const proveOwner = vi.hoisted(() => vi.fn());
const readRecord = vi.hoisted(() => vi.fn());
vi.mock("@/backend/agents/local/LocalSessionOwnership", () => ({
  proveLocalOwner: proveOwner,
}));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: readRecord,
}));

const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TURN_ID = "44444444-4444-4444-8444-444444444444";
const DIRECTORY = "/data/local-sessions/x";

const launch: LocalSessionLaunch = {
  runId: RUN_ID,
  stepId: "step",
  sessionScopeId: "step",
  attemptId: ATTEMPT_ID,
  turnId: ATTEMPT_ID,
  isInstruction: false,
  instanceId: INSTANCE_ID,
  userId: RUN_ID,
  prompt: "p",
  instruction: "",
  resumeSessionId: null,
  timeoutMinutes: 5,
  mcp: null,
};
const entry: LocalSessionEntry = {
  instanceId: INSTANCE_ID,
  instanceKey: "k",
  runId: RUN_ID,
  stepId: "step",
  attemptId: ATTEMPT_ID,
  manifestDigest: "",
  proof: null,
  acknowledgedSequence: 0,
  acknowledgedDigest: "",
  checkpointFile: null,
  releasedAt: null,
};
const identified: LocalSessionMutation = { kind: "identified", sessionId: "s" };

function inputWith(
  overrides: Partial<AgentPlanExecutionInput> = {},
): AgentPlanExecutionInput {
  return {
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
    userId: RUN_ID,
    prompt: "p",
    directory: null,
    recording: {
      key: {
        planId: RUN_ID,
        runId: RUN_ID,
        stepId: "step",
        attemptId: ATTEMPT_ID,
      },
      userId: RUN_ID,
      provider: "codex_cli",
      instanceId: INSTANCE_ID,
      groupId: null,
      directory: null,
    },
    ...overrides,
  };
}

function manifestOf(manifestLaunch: LocalSessionLaunch): {
  readonly manifest: LocalOwnerManifest;
} {
  return {
    manifest: {
      version: 1,
      instanceKey: "a".repeat(64),
      capability: "b".repeat(64),
      configPath: "c",
      directory: DIRECTORY,
      unit: `pages-local-${INSTANCE_ID}.service`,
      launch: manifestLaunch,
    },
  };
}

let root = "";

beforeEach(async () => {
  const parent = pagesTempDirectory("local-session-launch-test");
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, "run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("resolves the directory of a valid instance only", () => {
  expect(localSessionDirectory("/data", INSTANCE_ID)).toBe(
    `/data/local-sessions/${INSTANCE_ID}`,
  );
  expect(() => localSessionDirectory("/data", "../x")).toThrow(AgentError);
});

it("builds the launch of a regular turn", () => {
  expect(createLocalSessionLaunch(inputWith(), INSTANCE_ID, null, 5)).toEqual(
    launch,
  );
});

it("builds the launch of an instruction with tools and resumption", () => {
  const input = Object.assign(
    inputWith({
      acceptanceInstruction: "accept",
      resourceContext: {
        runId: RUN_ID,
        stepId: "step",
        sessionScopeId: "scope",
        isLocalInstruction: true,
      },
    }),
    { resumeSessionId: "resume" },
  );
  const built = createLocalSessionLaunch(
    input,
    INSTANCE_ID,
    { url: "http://x", tools: ["a"] },
    3,
  );
  expect(built).toMatchObject({
    isInstruction: true,
    sessionScopeId: "scope",
    instruction: "accept",
    resumeSessionId: "resume",
    mcp: { url: "http://x", tools: ["a"] },
    timeoutMinutes: 3,
  });
  expect(built.turnId).not.toBe(ATTEMPT_ID);
  expect(
    createLocalSessionLaunch(
      inputWith(),
      INSTANCE_ID,
      { url: "http://x", tools: null },
      1,
    ).mcp,
  ).toEqual({ url: "http://x", tools: null });
});

it("refuses a missing or foreign recording", () => {
  expect(() =>
    createLocalSessionLaunch(
      inputWith({ recording: undefined }),
      INSTANCE_ID,
      null,
      5,
    ),
  ).toThrow(AgentError);
  expect(() => createLocalSessionLaunch(inputWith(), RUN_ID, null, 5)).toThrow(
    AgentError,
  );
});

it("refuses an invalid launch", () => {
  expect(() =>
    createLocalSessionLaunch(inputWith(), INSTANCE_ID, null, -1),
  ).toThrow(AgentError);
});

it("reads the current launch from disk", async () => {
  readRecord.mockResolvedValueOnce(launch);
  expect(await readCurrentLocalLaunch(DIRECTORY, entry)).toEqual(launch);
  expect(readRecord).toHaveBeenCalledWith(path.join(DIRECTORY, "current.json"));
});

it("falls back to the manifest launch when no current file exists", async () => {
  readRecord.mockRejectedValueOnce(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  proveOwner.mockResolvedValueOnce(manifestOf(launch));
  expect(await readCurrentLocalLaunch(DIRECTORY, entry)).toEqual(launch);
  expect(proveOwner).toHaveBeenCalledWith(entry, DIRECTORY);
});

it("rethrows other failures reading the current launch", async () => {
  const failure = new Error("denied");
  readRecord.mockRejectedValueOnce(failure);
  await expect(readCurrentLocalLaunch(DIRECTORY, entry)).rejects.toBe(failure);
  readRecord.mockRejectedValueOnce("plain");
  await expect(readCurrentLocalLaunch(DIRECTORY, entry)).rejects.toBe("plain");
  readRecord.mockRejectedValueOnce(
    Object.assign(new Error("other"), { code: "EACCES" }),
  );
  await expect(readCurrentLocalLaunch(DIRECTORY, entry)).rejects.toThrow(
    "other",
  );
  expect(proveOwner).not.toHaveBeenCalled();
});

it("resolves the shared launch without a turn from the current file", async () => {
  proveOwner.mockResolvedValue(manifestOf(launch));
  readRecord.mockResolvedValueOnce({ ...launch, prompt: "current" });
  expect(await readSharedLocalLaunch(DIRECTORY, entry)).toMatchObject({
    prompt: "current",
  });
});

it("resolves the shared launch of the original turn from the manifest", async () => {
  proveOwner.mockResolvedValue(manifestOf(launch));
  expect(await readSharedLocalLaunch(DIRECTORY, entry, ATTEMPT_ID)).toEqual(
    launch,
  );
  expect(readRecord).not.toHaveBeenCalled();
});

it("reads the stored launch of a later turn", async () => {
  proveOwner.mockResolvedValue(manifestOf(launch));
  readRecord.mockResolvedValueOnce({ ...launch, turnId: OTHER_TURN_ID });
  expect(
    await readSharedLocalLaunch(DIRECTORY, entry, OTHER_TURN_ID),
  ).toMatchObject({ turnId: OTHER_TURN_ID });
  expect(readRecord).toHaveBeenCalledWith(
    path.join(DIRECTORY, `turn-${OTHER_TURN_ID}.json`),
  );
});

it("refuses a malformed turn identifier", async () => {
  proveOwner.mockResolvedValue(manifestOf(launch));
  await expect(
    readSharedLocalLaunch(DIRECTORY, entry, "../escape"),
  ).rejects.toThrow(AgentError);
});

function openDatabase(): Database {
  const created: unknown = Reflect.construct(Database, [{}, root]);
  if (!(created instanceof Database)) throw new Error("not a database");
  return created;
}

function ownersOf(
  entries: readonly LocalSessionEntry[],
): Parameters<typeof readLocalSessionMilestones>[0] {
  return Object.assign(Object.create(null), {
    list: async () => entries,
  });
}

it("returns no session milestones without an entry or checkpoint", async () => {
  const database = openDatabase();
  expect(
    await readLocalSessionMilestones(ownersOf([]), "k", database, INSTANCE_ID),
  ).toEqual([]);
  expect(
    await readLocalSessionMilestones(
      ownersOf([entry]),
      "k",
      database,
      INSTANCE_ID,
    ),
  ).toEqual([]);
});

it("reads session milestones of a checkpoint", async () => {
  const database = openDatabase();
  const reference = await database.agentFiles?.write(
    "plan",
    JSON.stringify([identified]),
  );
  expect(
    await readLocalSessionMilestones(
      ownersOf([{ ...entry, checkpointFile: reference ?? null }]),
      "k",
      database,
      INSTANCE_ID,
    ),
  ).toEqual([identified]);
});

it("rejects a checkpoint that is not a list", async () => {
  const database = openDatabase();
  const reference = await database.agentFiles?.write("plan", "{}");
  await expect(
    readLocalSessionMilestones(
      ownersOf([{ ...entry, checkpointFile: reference ?? null }]),
      "k",
      database,
      INSTANCE_ID,
    ),
  ).rejects.toThrow("Invalid local session checkpoint");
});
