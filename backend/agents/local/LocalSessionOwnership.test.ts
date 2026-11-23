import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  captureLocalOwner,
  hasEndedLocalOwner,
  localManagerEnvironment,
  localManifestDigest,
  proveLocalOwner,
} from "@/backend/agents/local/LocalSessionOwnership";

import type {
  LocalOwnerManifest,
  LocalOwnerProof,
} from "@/backend/agents/local/LocalSessionContracts";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

type ExecCallback = (error: Error | null, result?: unknown) => void;

const world = vi.hoisted(() => ({
  files: new Map<string, string>(),
  uid: 0,
  records: new Map<string, unknown>(),
  show: vi.fn(),
  ended: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: async (file: string, encoding?: string) => {
    const content = world.files.get(file);
    if (content === undefined) throw new Error(`missing ${file}`);
    return encoding ? content : Buffer.from(content);
  },
  stat: async () => ({ uid: world.uid }),
}));
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: readonly string[],
    options: unknown,
    callback: ExecCallback,
  ) => {
    Promise.resolve(world.show(command, args, options)).then(
      (result: unknown) => callback(null, result),
      (error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error))),
    );
  },
}));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: async (file: string) => {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (!world.records.has(name)) throw new Error(`no record ${name}`);
    return world.records.get(name);
  },
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: world.ended,
}));

const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const BOOT = "44444444-4444-4444-8444-444444444444";
const DIRECTORY = "/data/local-sessions/x";
const CONFIG = "/data/local-sessions/x/config.json";
const PID = 4242;
const START = 98765;
const CGROUP = "/user.slice/pages-local.service";
const INVOCATION = "a".repeat(32);

const manifest: LocalOwnerManifest = {
  version: 1,
  instanceKey: "a".repeat(64),
  capability: "b".repeat(64),
  configPath: CONFIG,
  directory: DIRECTORY,
  unit: `pages-local-${INSTANCE_ID}.service`,
  launch: {
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
  },
};
const proof: LocalOwnerProof = {
  instanceKey: manifest.instanceKey,
  instanceId: INSTANCE_ID,
  runId: RUN_ID,
  stepId: "step",
  attemptId: ATTEMPT_ID,
  unit: manifest.unit,
  invocationId: INVOCATION,
  boot: BOOT,
  uid: 0,
  pid: PID,
  start: START,
  cgroup: CGROUP,
  arguments: ["node", DIRECTORY, CONFIG],
};
const entry: LocalSessionEntry = {
  instanceId: INSTANCE_ID,
  instanceKey: manifest.instanceKey,
  runId: RUN_ID,
  stepId: "step",
  attemptId: ATTEMPT_ID,
  manifestDigest: localManifestDigest(manifest),
  proof: null,
  acknowledgedSequence: 0,
  acknowledgedDigest: "",
  checkpointFile: null,
  releasedAt: null,
};

function statLine(state: string, start: string): string {
  return `${PID} (a b) ${[state, ...Array<string>(18).fill("0"), start].join(" ")} 0`;
}

function setProcess(pid: number, start = String(START), state = "S"): void {
  world.files.set(`/proc/${pid}/stat`, statLine(state, start));
  world.files.set(`/proc/${pid}/cgroup`, `1:name=x:/a\n0::${CGROUP}\n`);
  world.files.set(`/proc/${pid}/cmdline`, proof.arguments.join("\0") + "\0");
}

function unitText(overrides: Record<string, string> = {}): {
  readonly stdout: string;
} {
  const properties = {
    MainPID: String(PID),
    InvocationID: INVOCATION,
    ControlGroup: CGROUP,
    ActiveState: "active",
    ...overrides,
  };
  return {
    stdout: `${Object.entries(properties)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  };
}

function setRecords(
  nextManifest: unknown = manifest,
  nextProof: unknown = proof,
): void {
  world.records.set("manifest.json", nextManifest);
  world.records.set("proof.json", nextProof);
}

beforeEach(() => {
  world.files.clear();
  world.records.clear();
  world.uid = process.getuid?.() ?? 0;
  world.files.set("/proc/sys/kernel/random/boot_id", `${BOOT}\n`);
  setProcess(PID);
  setRecords(manifest, { ...proof, uid: world.uid });
  world.show.mockImplementation(async () => unitText());
  world.ended.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

async function expectProofFailure(message: string): Promise<void> {
  await expect(proveLocalOwner(entry, DIRECTORY)).rejects.toThrow(message);
}

it("builds the manager environment of the server account", () => {
  const runtime = `/run/user/${process.getuid?.()}`;
  expect(localManagerEnvironment()).toEqual({
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
  });
});

it("builds the manager environment without a user id", () => {
  const original = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    expect(localManagerEnvironment().XDG_RUNTIME_DIR).toBe(
      "/run/user/undefined",
    );
  } finally {
    if (original) Object.defineProperty(process, "getuid", original);
  }
});

it("hashes the manifest deterministically", () => {
  expect(localManifestDigest(manifest)).toMatch(/^[a-f0-9]{64}$/u);
  expect(localManifestDigest(manifest)).toBe(localManifestDigest(manifest));
  expect(
    localManifestDigest({ ...manifest, version: 1, configPath: "x" }),
  ).not.toBe(localManifestDigest(manifest));
});

it("accepts an owner whose records, unit and process all agree", async () => {
  const owned = await proveLocalOwner(entry, DIRECTORY);
  expect(owned.manifest).toEqual(manifest);
  expect(owned.proof.pid).toBe(PID);
  expect(world.show).toHaveBeenCalledWith(
    "/usr/bin/systemctl",
    [
      "--user",
      "show",
      manifest.unit,
      "--property=MainPID,InvocationID,ControlGroup,ActiveState",
    ],
    expect.objectContaining({ timeout: 2000 }),
  );
});

it("accepts a stored proof identical to the recorded one", async () => {
  const stored = { ...proof, uid: world.uid };
  expect(
    (await proveLocalOwner({ ...entry, proof: stored }, DIRECTORY)).proof,
  ).toEqual(stored);
});

it("refuses a stored proof that differs from the recorded one", async () => {
  await expect(
    proveLocalOwner({ ...entry, proof: { ...proof, pid: 1 } }, DIRECTORY),
  ).rejects.toThrow("Local owner invocation changed");
});

it("refuses a manifest bound to another directory", async () => {
  setRecords({ ...manifest, directory: "/elsewhere" }, proof);
  await expectProofFailure("Local owner directory binding mismatch");
});

it.each([
  ["digest", { manifestDigest: "0" }],
  ["instance key", { instanceKey: "c".repeat(64) }],
  ["instance", { instanceId: RUN_ID }],
  ["run", { runId: INSTANCE_ID }],
  ["step", { stepId: "other" }],
  ["attempt", { attemptId: RUN_ID }],
])("refuses an entry with another %s", async (label, change) => {
  await expect(
    proveLocalOwner({ ...entry, ...change }, DIRECTORY),
  ).rejects.toThrow("Local owner launch binding mismatch");
});

it.each([
  ["instance key", { instanceKey: "other" }],
  ["instance", { instanceId: RUN_ID }],
  ["run", { runId: INSTANCE_ID }],
  ["step", { stepId: "other" }],
  ["attempt", { attemptId: RUN_ID }],
  ["unit", { unit: "other.service" }],
])("refuses a proof of another %s", async (label, change) => {
  setRecords(manifest, { ...proof, uid: world.uid, ...change });
  await expectProofFailure("Local owner proof binding mismatch");
});

it.each([
  ["user", () => setProcess(PID, String(START)), { uid: world.uid + 1 }],
  ["start", () => setProcess(PID, "1"), {}],
  [
    "boot",
    () => world.files.set("/proc/sys/kernel/random/boot_id", `${RUN_ID}\n`),
    {},
  ],
  ["group", () => world.files.set(`/proc/${PID}/cgroup`, "0::/other\n"), {}],
])("refuses a process with another %s", async (label, change, patch) => {
  change();
  setRecords(manifest, { ...proof, uid: world.uid, ...patch });
  await expectProofFailure("Local owner process identity changed");
});

it("refuses a process owned by another user than the server", async () => {
  world.uid = (process.getuid?.() ?? 0) + 1;
  setRecords(manifest, { ...proof, uid: world.uid });
  await expectProofFailure("Local owner process identity changed");
});

it.each([
  ["arguments", [...proof.arguments, "extra"]],
  ["directory", ["node", CONFIG]],
  ["configuration", ["node", DIRECTORY]],
])("refuses a command with other %s", async (label, argumentsList) => {
  world.files.set(`/proc/${PID}/cmdline`, `${argumentsList.join("\0")}\0`);
  setRecords(manifest, {
    ...proof,
    uid: world.uid,
    arguments: label === "arguments" ? proof.arguments : argumentsList,
  });
  await expectProofFailure("Local owner command binding mismatch");
});

it.each([
  ["main process", { MainPID: "1" }],
  ["invocation", { InvocationID: "b".repeat(32) }],
  ["control group", { ControlGroup: "/other" }],
  ["state", { ActiveState: "failed" }],
])("refuses a unit with another %s", async (label, change) => {
  world.show.mockImplementation(async () => unitText(change));
  await expectProofFailure("Local owner unit identity changed");
});

it("refuses a process that is not live", async () => {
  setProcess(PID, String(START), "Z");
  await expectProofFailure("Local owner process is not live");
  setProcess(PID, "invalid");
  await expectProofFailure("Local owner process is not live");
});

it("refuses a process without a unified cgroup", async () => {
  world.files.set(`/proc/${PID}/cgroup`, "1:name=x:/a\n");
  await expectProofFailure("Local owner cgroup is unavailable");
});

it("retries a failing unit read and then succeeds", async () => {
  vi.useFakeTimers();
  world.show
    .mockRejectedValueOnce(new Error("bus"))
    .mockRejectedValueOnce(new Error("bus"))
    .mockImplementation(async () => unitText());
  const pending = proveLocalOwner(entry, DIRECTORY);
  await vi.advanceTimersByTimeAsync(750);
  expect((await pending).proof.pid).toBe(PID);
  expect(world.show).toHaveBeenCalledTimes(3);
});

it("gives up after the last unit read attempt", async () => {
  vi.useFakeTimers();
  world.show.mockRejectedValue(new Error("bus down"));
  const pending = proveLocalOwner(entry, DIRECTORY);
  const outcome = expect(pending).rejects.toThrow("bus down");
  await vi.advanceTimersByTimeAsync(750);
  await outcome;
  expect(world.show).toHaveBeenCalledTimes(3);
});

it("captures the identity of the running process", async () => {
  vi.stubEnv("INVOCATION_ID", INVOCATION);
  setProcess(process.pid);
  const captured = await captureLocalOwner(manifest);
  expect(captured).toMatchObject({
    instanceKey: manifest.instanceKey,
    instanceId: INSTANCE_ID,
    runId: RUN_ID,
    stepId: "step",
    attemptId: ATTEMPT_ID,
    unit: manifest.unit,
    invocationId: INVOCATION,
    pid: process.pid,
    start: START,
    boot: BOOT,
    cgroup: CGROUP,
    arguments: proof.arguments,
  });
});

function showEnded(load: string, active: string): void {
  world.show.mockImplementation(async () => ({
    stdout: `LoadState=${load}\nActiveState=${active}\n`,
  }));
}

it("treats a running unit as not ended", async () => {
  showEnded("loaded", "active");
  expect(await hasEndedLocalOwner(entry, DIRECTORY)).toBe(false);
  expect(world.ended).not.toHaveBeenCalled();
});

it.each([
  ["not-found", "active"],
  ["loaded", "inactive"],
  ["not-found", "inactive"],
])("checks the namespace of a %s/%s unit", async (load, active) => {
  showEnded(load, active);
  world.ended.mockResolvedValueOnce(false);
  expect(await hasEndedLocalOwner(entry, DIRECTORY)).toBe(false);
  world.ended.mockResolvedValueOnce(true);
  expect(await hasEndedLocalOwner(entry, DIRECTORY)).toBe(true);
  expect(world.ended).toHaveBeenCalledWith({
    pid: PID,
    uid: world.uid,
    start: START,
    boot: BOOT,
  });
  expect(world.show).toHaveBeenCalledWith(
    "/usr/bin/systemctl",
    ["--user", "show", manifest.unit, "--property=LoadState,ActiveState"],
    expect.objectContaining({ timeout: 10_000 }),
  );
});

it("refuses to judge an unbound owner ended", async () => {
  setRecords({ ...manifest, directory: "/elsewhere" }, proof);
  await expect(hasEndedLocalOwner(entry, DIRECTORY)).rejects.toThrow(
    "Local owner directory binding mismatch",
  );
  setRecords(manifest, { ...proof, uid: world.uid });
  await expect(
    hasEndedLocalOwner({ ...entry, manifestDigest: "0" }, DIRECTORY),
  ).rejects.toThrow("Local owner launch binding mismatch");
  await expect(
    hasEndedLocalOwner({ ...entry, proof: { ...proof, pid: 1 } }, DIRECTORY),
  ).rejects.toThrow("Local owner invocation changed");
  expect(world.show).not.toHaveBeenCalled();
});
