import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
  readServerScope,
  readSpawnScope,
  RUN_INSTANCE_VARIABLE,
} from "./CliProcessScan";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  stopWorkerUnits: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("./CliWorkerUnit", () => ({
  stopWorkerUnits: mocks.stopWorkerUnits,
}));

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function statLine(start: string, name = "node"): string {
  const fields = Array.from({ length: 18 }, () => "0");
  return `1 (${name}) S ${fields.join(" ")} ${start} 0`;
}

function files(contents: Readonly<Record<string, string>>): void {
  vi.mocked(readFile).mockImplementation((async (file: string) => {
    const content = contents[file];
    if (content === undefined) throw errorWith("ENOENT");
    return content;
  }) as never);
}

function errorWith(code: string): Error {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

it("exports the legacy tag variable name", () => {
  expect(RUN_INSTANCE_VARIABLE).toBe("PAGES_RUN_INSTANCE");
});

it("reads the server start even when the name has spaces and parentheses", async () => {
  files({ "/proc/self/stat": statLine("12345", "a (b) c") });
  await expect(readServerScope()).resolves.toEqual({ earliestStart: 12345 });
});

it("fails when the server process vanished", async () => {
  files({});
  await expect(readServerScope("/x")).rejects.toThrow("no start time");
});

it("logs and rethrows an unreadable process file", async () => {
  const failure = errorWith("EACCES");
  vi.mocked(readFile).mockRejectedValue(failure);
  await expect(readServerScope()).rejects.toBe(failure);
  expect(mocks.logCaughtError).toHaveBeenCalledWith("CliProcessScan", failure);
});

it("treats a non-error rejection as unreadable and rethrows it", async () => {
  vi.mocked(readFile).mockRejectedValue("plain");
  await expect(readServerScope()).rejects.toBe("plain");
});

it("treats a vanished process as ended for ESRCH and plain errors alike", async () => {
  vi.mocked(readFile).mockRejectedValue(errorWith("ESRCH"));
  await expect(readServerScope()).rejects.toThrow("no start time");
  vi.mocked(readFile).mockRejectedValue(new Error("no code"));
  await expect(readServerScope()).rejects.toThrow("no code");
});

it.each(["abc", "-1", "1.5"])("rejects the start time %s", async (start) => {
  files({ "/proc/self/stat": statLine(start) });
  await expect(readServerScope()).rejects.toThrow("Unreadable process start");
});

it("captures a spawn scope from the uptime", async () => {
  files({ "/proc/uptime": "12.345 99.0" });
  await expect(readSpawnScope()).resolves.toEqual({ earliestStart: 1234 });
});

it.each(["abc 1", "-5 1"])("rejects the uptime %s", async (uptime) => {
  files({ "/proc/uptime": uptime });
  await expect(readSpawnScope()).rejects.toThrow("Unreadable system uptime");
});

it("rejects an invalid session timestamp", async () => {
  await expect(readScopeSince("garbage")).rejects.toThrow(
    "Invalid session start",
  );
});

it("cannot rule out anything for a start in the future", async () => {
  files({ "/proc/uptime": "1000 1" });
  await expect(readScopeSince("2026-01-01T00:10:00.000Z")).resolves.toEqual({
    earliestStart: 0,
  });
});

it("keeps nothing of a session from an earlier boot", async () => {
  files({ "/proc/uptime": "100 1" });
  await expect(readScopeSince("2025-12-31T00:00:00.000Z")).resolves.toEqual({
    earliestStart: Number.POSITIVE_INFINITY,
  });
});

it("bounds a recent session by its start minus the tolerance", async () => {
  files({ "/proc/uptime": "1000 1" });
  await expect(
    readScopeSince("2025-12-31T23:50:00.000Z", "/proc"),
  ).resolves.toEqual({ earliestStart: (1000 - 600 - 60) * 100 });
});

it("never lets the bound drop below zero", async () => {
  files({ "/proc/uptime": "10 1" });
  await expect(readScopeSince("2025-12-31T23:59:30.000Z")).resolves.toEqual({
    earliestStart: 0,
  });
});

it("finds no processes and reports that as not confirmed", async () => {
  await expect(findTaggedProcesses("tag")).resolves.toBeNull();
});

it("stops worker units, then reports the closeout as unverified", async () => {
  mocks.stopWorkerUnits.mockResolvedValue(undefined);
  await expect(endTaggedProcesses("tag")).rejects.toThrow(
    "Process ownership is unverified for legacy session tag",
  );
  expect(mocks.stopWorkerUnits).toHaveBeenCalledWith("tag");
});

it("logs a failing unit stop and still reports unverified", async () => {
  const failure = new Error("stop failed");
  mocks.stopWorkerUnits.mockRejectedValue(failure);
  await expect(endTaggedProcesses("tag", { earliestStart: 1 })).rejects.toThrow(
    "unverified",
  );
  expect(mocks.logCaughtError).toHaveBeenCalledWith("CliProcessScan", failure);
});
