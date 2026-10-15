import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";
import { notesAliasPaths } from "@/backend/agents/cli/CliNotesAliases";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("node:fs/promises", () => ({
  access: async () => {},
  realpath: async (file: string) => file,
  lstat: async () => ({
    uid: process.getuid?.(),
    mode: 0o700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }),
  readFile: async () =>
    "1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 8:1 /notes /mirror rw - ext4 /dev/root rw\n3 1 8:1 /notes/plan/foreign /foreign-alias rw - ext4 /dev/root rw",
}));

const REQUEST: CliSessionRequest = {
  file: "/synthetic/bin/claude-agent-acp",
  arguments: [],
  provider: "claude_code",
  home: {
    root: "/synthetic/data/agents/connection",
    home: "/synthetic/data/agents/connection/home",
    config: "/synthetic/data/agents/connection/claude",
    work: "/synthetic/data/agents/connection/work",
  },
  workingDirectory: "/synthetic/workspace",
  environment: {},
  timeoutMs: 0,
  signal: new AbortController().signal,
  onLine: () => {},
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("keeps a working probe for the life of the server", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  expect(await isolation.isolate(REQUEST)).not.toBeNull();
  vi.advanceTimersByTime(24 * 60 * 60_000);
  expect(await isolation.isolate(REQUEST)).not.toBeNull();
  expect(probe).toHaveBeenCalledTimes(1);
});

it("repeats a failed probe after a minute, so installing bubblewrap needs no restart", async () => {
  const results = [false, true];
  const probe = vi.fn(async () => results.shift() ?? true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  expect(await isolation.isolate(REQUEST)).toBeNull();
  // Within the minute the failure stands and nothing is probed again.
  vi.advanceTimersByTime(30_000);
  expect(await isolation.isolate(REQUEST)).toBeNull();
  expect(probe).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(31_000);
  const isolated = await isolation.isolate(REQUEST);
  expect(isolated?.file).toBe("/usr/bin/bwrap");
  expect(isolated?.toolFile).toBe("/synthetic/bin/claude-agent-acp");
  expect(probe).toHaveBeenCalledTimes(2);
});

it("probes once for concurrent starts", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  await Promise.all([
    isolation.isolate(REQUEST),
    isolation.isolate(REQUEST),
    isolation.isolate(REQUEST),
  ]);
  expect(probe).toHaveBeenCalledTimes(1);
});

it("refreshes a positive cached probe for notes creation when namespaces stop working", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation([], probe);
  expect(await isolation.isAvailable()).toBe(true);
  probe.mockResolvedValue(false);
  expect(await isolation.isAvailable({ refresh: true })).toBe(false);
  expect(probe).toHaveBeenCalledTimes(2);
});

it("mounts the workspace read-only for Nur Lesen and hides the instance folders", async () => {
  const isolation = new CliPlanIsolation(["/synthetic/data"], async () => true);
  const isolated = await isolation.isolate({
    ...REQUEST,
    isWorkingDirectoryReadOnly: true,
  });
  const args = isolated?.arguments ?? [];
  expect(args[args.indexOf("/synthetic/workspace") - 1]).toBe("--ro-bind");
  expect(args).toEqual(expect.arrayContaining(["--tmpfs", "/synthetic/data"]));
});

it("hides all temp aliases before binding only the current run, including for read-only workspaces", async () => {
  const isolation = new CliPlanIsolation(
    ["/synthetic/data"],
    async () => true,
    "/notes",
  );
  const notes = { root: "/notes", directory: "/notes/plan/run" };
  const args =
    (
      await isolation.isolate({
        ...REQUEST,
        notes,
        isWorkingDirectoryReadOnly: true,
      })
    )?.arguments ?? [];
  const ownBind = args.indexOf(notes.directory);
  expect(args[ownBind - 1]).toBe("--bind");
  for (const hidden of ["/notes", "/mirror", "/foreign-alias"])
    expect(args.indexOf(hidden)).toBeLessThan(ownBind);
  expect(args.slice(ownBind - 1, ownBind + 2)).toEqual([
    "--bind",
    notes.directory,
    notes.directory,
  ]);
  expect(
    args.filter((argument) => argument.startsWith("/notes/plan/")),
  ).toEqual([notes.directory, notes.directory]);
});

it("hides temp from CLI nodes without notes and rejects remounts that would expose it", async () => {
  const isolation = new CliPlanIsolation(
    ["/synthetic/data"],
    async () => true,
    "/notes",
  );
  const request = await isolation.isolate(REQUEST);
  expect(request?.arguments).toContain("/notes");
  expect(request?.arguments).not.toContain("/notes/plan/run");
  for (const workingDirectory of [
    "/",
    "/notes/plan/foreign",
    "/mirror/plan/foreign",
  ])
    await expect(
      isolation.isolate({ ...REQUEST, workingDirectory }),
    ).rejects.toThrow();
  await expect(
    isolation.isolate({ ...REQUEST, credentialDirectory: "/notes" }),
  ).rejects.toThrow();
  await expect(
    isolation.isolate({
      ...REQUEST,
      home: { ...REQUEST.home, root: "/mirror" },
    }),
  ).rejects.toThrow();
});

it("rejects traversal and a notes capability belonging to another temp root", async () => {
  const isolation = new CliPlanIsolation([], async () => true, "/notes");
  for (const notes of [
    { root: "/foreign", directory: "/foreign/plan/run" },
    { root: "/notes", directory: "/notes/../escape/run" },
  ])
    await expect(
      isolation.isolate({ ...REQUEST, notes }),
    ).rejects.toMatchObject({ code: "plan_notes_path_invalid" });
});

it("resolves mount roots and escaped spaces instead of relying on textual path prefixes", () => {
  const table =
    "1 0 8:1 /disk / rw - ext4 /dev/root rw\n2 1 8:1 /disk/home /shared\\040home rw - ext4 /dev/root rw\n3 1 8:1 /disk/home/.pages/temp/plan/run /subtree rw - ext4 /dev/root rw";
  expect(notesAliasPaths("/home/.pages/temp", table)).toEqual([
    "/home/.pages/temp",
    "/shared home/.pages/temp",
    "/subtree",
  ]);
  expect(() => notesAliasPaths("/notes", "invalid mount table")).toThrow();
});
