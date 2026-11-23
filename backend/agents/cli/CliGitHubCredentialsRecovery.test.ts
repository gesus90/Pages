import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import type * as FsModule from "node:fs/promises";
import type * as TempDirectoryModule from "@/backend/config/PagesTempDirectory";

const mocks = vi.hoisted(() => ({
  root: { current: "" },
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  endTaggedProcesses: vi.fn(),
  readScopeSince: vi.fn(),
  settleOwnedNamespace: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
}));
vi.mock("@/backend/config/PagesTempDirectory", () => ({
  pagesTempDirectory: (...parts: readonly string[]) =>
    [mocks.root.current, "tmp", ...parts].join("/"),
}));
vi.mock("@/backend/agents/cli/CliGitBridge", () => ({
  openCliGitBridge: vi.fn(),
  writeGitBridgeClient: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  endTaggedProcesses: mocks.endTaggedProcesses,
  readScopeSince: mocks.readScopeSince,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  settleOwnedNamespace: mocks.settleOwnedNamespace,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  readdir: mocks.readdir,
  rm: mocks.rm,
  stat: mocks.stat,
}));

const { pagesTempDirectory: realTempDirectory } = await vi.importActual<
  typeof TempDirectoryModule
>("@/backend/config/PagesTempDirectory");

const FIRST = "0b1c2d3e-4f50-4162-8394-a5b6c7d8e9f0";
const SECOND = "1c2d3e4f-5061-4273-8495-b6c7d8e9f0a1";
const OWNER = {
  pid: 42,
  uid: process.getuid?.() ?? 0,
  start: 7,
  boot: "0b1c2d3e-4f50-4162-8394-a5b6c7d8e9f0",
};
let dataDirectory = "";
let credentials = new CliGitHubCredentials("");

beforeEach(async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs/promises");
  mocks.readdir.mockImplementation(actual.readdir);
  mocks.rm.mockImplementation(actual.rm);
  mocks.stat.mockImplementation(actual.stat);
  mocks.endTaggedProcesses.mockResolvedValue({ found: 0, remaining: 0 });
  mocks.readScopeSince.mockResolvedValue({ earliestStart: 5 });
  mocks.settleOwnedNamespace.mockResolvedValue(true);
  const base = realTempDirectory("credentials-test");
  await mkdir(base, { recursive: true, mode: 0o700 });
  mocks.root.current = await mkdtemp(path.join(base, "recovery-"));
  dataDirectory = path.join(mocks.root.current, "data");
  await mkdir(dataDirectory);
  credentials = new CliGitHubCredentials(dataDirectory);
});

afterEach(async () => {
  await rm(mocks.root.current, { recursive: true, force: true });
});

async function leftover(
  instanceId: string,
  marker?: { readonly content: string; readonly mode: number },
): Promise<string> {
  const name = `acp-github-${instanceId}-abc123`;
  const directory = path.join(dataDirectory, name);
  await mkdir(directory);
  await writeFile(path.join(directory, "hosts.yml"), "secret");
  if (marker) {
    const file = path.join(directory, "namespace.json");
    await writeFile(file, marker.content);
    // The mode is set after the write, so the umask of the process cannot change it.
    await chmod(file, marker.mode);
  }
  return name;
}

function ownerMarker(mode = 0o400): { content: string; mode: number } {
  return { content: JSON.stringify(OWNER), mode };
}

async function names(): Promise<string[]> {
  return readdir(dataDirectory);
}

it("removes the leftover of an ended namespace and reports nothing", async () => {
  const name = await leftover(FIRST, ownerMarker());
  expect(await credentials.recover()).toEqual([]);
  expect(await names()).not.toContain(name);
  expect(mocks.settleOwnedNamespace).toHaveBeenCalledWith(OWNER, FIRST);
  expect(mocks.logDiagnostic).toHaveBeenCalledWith(
    "CliGitHubCredentials",
    "info",
    "[pages] Removed credentials of an interrupted session.",
  );
  expect(credentials.leftovers()).toEqual([]);
});

it("keeps a leftover whose recorded namespace still runs", async () => {
  const name = await leftover(FIRST, ownerMarker());
  mocks.settleOwnedNamespace.mockResolvedValue(false);
  const result = await credentials.recover();
  expect(result).toEqual([
    { directory: name, instanceId: FIRST, reason: "processes" },
  ]);
  expect(credentials.leftovers()).toBe(result);
  expect(await names()).toContain(name);
});

it("skips entries that are no credential folder and preserved sessions", async () => {
  await writeFile(
    path.join(dataDirectory, `acp-github-${FIRST}-abc123`),
    "file",
  );
  await mkdir(path.join(dataDirectory, "other"));
  await mkdir(path.join(dataDirectory, `acp-github-${"a".repeat(36)}-abc123`));
  const kept = await leftover(SECOND, ownerMarker());
  expect(await credentials.recover(new Set([SECOND]))).toEqual([]);
  expect(await names()).toContain(kept);
  expect(mocks.settleOwnedNamespace).not.toHaveBeenCalled();
});

it("quarantines a leftover whose owner is unverified without signalling anything", async () => {
  const name = await leftover(FIRST);
  expect(await credentials.recover(new Set(), new Set([FIRST]))).toEqual([
    { directory: name, instanceId: FIRST, reason: "processes" },
  ]);
  expect(mocks.logDiagnostic).toHaveBeenCalledWith(
    "CliGitHubCredentials",
    "error",
    expect.stringContaining("is unverified"),
  );
  expect(mocks.endTaggedProcesses).not.toHaveBeenCalled();
});

it("handles a legacy leftover without a marker by its creation time", async () => {
  const name = await leftover(FIRST);
  expect(await credentials.recover()).toEqual([]);
  expect(await names()).not.toContain(name);
  expect(mocks.endTaggedProcesses).toHaveBeenCalledWith(FIRST, {
    earliestStart: 5,
  });
  expect(mocks.readScopeSince).toHaveBeenCalledWith(
    expect.stringMatching(/^\d{4}-/u),
  );
});

it("falls back to the change time when the file system has no birth time", async () => {
  await leftover(FIRST);
  await leftover(SECOND);
  const actual = await vi.importActual<typeof FsModule>("node:fs/promises");
  mocks.stat.mockImplementation(async (file: string) => ({
    ...(await actual.stat(file)),
    birthtimeMs: 0,
    ctimeMs: 1_700_000_000_000,
  }));
  mocks.readScopeSince
    .mockResolvedValueOnce({ earliestStart: Number.POSITIVE_INFINITY })
    .mockResolvedValueOnce({ earliestStart: 9 });
  await credentials.recover();
  expect(mocks.readScopeSince).toHaveBeenCalledWith(
    new Date(1_700_000_000_000).toISOString(),
  );
  const scopes = mocks.endTaggedProcesses.mock.calls.map(([, scope]) => scope);
  expect(scopes).toEqual([{ earliestStart: Number.POSITIVE_INFINITY }, null]);
});

it("keeps a legacy leftover whose processes remain or cannot be confirmed", async () => {
  const first = await leftover(FIRST);
  const second = await leftover(SECOND);
  mocks.endTaggedProcesses
    .mockResolvedValueOnce({ found: 1, remaining: 1 })
    .mockRejectedValueOnce(new Error("unverified"));
  const result = await credentials.recover();
  expect(result).toEqual([
    { directory: first, instanceId: FIRST, reason: "processes" },
    { directory: second, instanceId: SECOND, reason: "processes" },
  ]);
  expect(mocks.logCaughtError).toHaveBeenCalledTimes(1);
  expect(mocks.logDiagnostic).toHaveBeenCalledWith(
    "CliGitHubCredentials",
    "error",
    expect.stringContaining("could not be confirmed"),
    expect.any(Error),
  );
});

it("distrusts a marker that is not a private regular file of this account", async () => {
  const directories = [
    await leftover(FIRST, ownerMarker(0o644)),
    await leftover(SECOND, { content: "x".repeat(2000), mode: 0o400 }),
  ];
  const third = "2d3e4f50-6172-4384-8596-c7d8e9f0a1b2";
  directories.push(await leftover(third, { content: "{", mode: 0o400 }));
  const fourth = "3e4f5061-7283-4495-8697-d8e9f0a1b2c3";
  directories.push(await leftover(fourth));
  await rm(path.join(dataDirectory, directories[3] ?? ""), { recursive: true });
  await mkdir(path.join(dataDirectory, directories[3] ?? ""));
  await mkdir(path.join(dataDirectory, directories[3] ?? "", "namespace.json"));
  const result = await credentials.recover();
  expect(result.map((entry) => entry.reason)).toEqual([
    "processes",
    "processes",
    "processes",
    "processes",
  ]);
  expect(mocks.settleOwnedNamespace).not.toHaveBeenCalled();
});

it("distrusts a marker symlink and a marker of another account", async () => {
  const name = await leftover(FIRST);
  await symlink("hosts.yml", path.join(dataDirectory, name, "namespace.json"));
  const other = await leftover(SECOND, ownerMarker());
  vi.spyOn(process, "getuid").mockReturnValue(OWNER.uid + 1);
  const result = await credentials.recover();
  expect(result.map((entry) => entry.directory).sort()).toEqual(
    [name, other].sort(),
  );
});

it("keeps a leftover whose removal fails, to retry at a later start", async () => {
  const name = await leftover(FIRST, ownerMarker());
  mocks.rm.mockRejectedValueOnce(new Error("busy"));
  expect(await credentials.recover()).toEqual([
    { directory: name, instanceId: FIRST, reason: "removal" },
  ]);
  expect(mocks.logDiagnostic).toHaveBeenCalledWith(
    "CliGitHubCredentials",
    "error",
    expect.stringContaining("cleanup failed"),
    expect.any(Error),
  );
});

it("removes only the runner folders of the named job", async () => {
  const root = path.join(mocks.root.current, "tmp", "runner-github");
  await mkdir(path.join(root, `runner-github-${FIRST}-abc123`), {
    recursive: true,
  });
  await mkdir(path.join(root, `runner-github-${SECOND}-abc123`));
  await writeFile(path.join(root, `runner-github-${FIRST}-file`), "");
  await credentials.cleanupRunner(FIRST);
  expect((await readdir(root)).sort()).toEqual(
    [`runner-github-${FIRST}-file`, `runner-github-${SECOND}-abc123`].sort(),
  );
  await chmod(root, 0o700);
});

it("does nothing for a runner without a folder and refuses a bad job id", async () => {
  await expect(credentials.cleanupRunner(FIRST)).resolves.toBeUndefined();
  await expect(credentials.cleanupRunner("../x")).rejects.toMatchObject({
    code: "secret_unavailable",
  });
});

it("passes on other read errors of the runner folder", async () => {
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  mocks.readdir.mockRejectedValueOnce(denied);
  await expect(credentials.cleanupRunner(FIRST)).rejects.toBe(denied);
  mocks.readdir.mockRejectedValueOnce(new Error("plain"));
  await expect(credentials.cleanupRunner(FIRST)).rejects.toThrow("plain");
  mocks.readdir.mockRejectedValueOnce("text");
  await expect(credentials.cleanupRunner(FIRST)).rejects.toBe("text");
  expect(await stat(dataDirectory)).toBeDefined();
});
