import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  accountTasks,
  cleanup,
  rememberOwnership,
} from "@/scripts/runner/processes.mjs";

const boundary = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
  rm: vi.fn(),
  identity: vi.fn(),
  readRecord: vi.fn(),
  readOwnedLaunch: vi.fn(),
  store: vi.fn(),
  cleanupPagesFiles: vi.fn(),
}));

vi.mock("node:fs/promises", () => boundary);
vi.mock("@/scripts/runner/journal.mjs", () => boundary);
vi.mock("@/scripts/runner/pages.mjs", () => boundary);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PAGES_RUNNER_JOB_NAMESPACE", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("records the dispatcher's ancestry with each process identity", async () => {
  boundary.readFile.mockResolvedValueOnce("99 (worker) S 42 99");
  boundary.readFile.mockResolvedValueOnce("42 (parent) S 0 42");
  boundary.identity
    .mockResolvedValueOnce("worker:1")
    .mockResolvedValueOnce("parent:2");
  await rememberOwnership("/jobs/synthetic");
  expect(boundary.store).toHaveBeenCalledWith(
    "/jobs/synthetic/ownership.json",
    {
      ancestors: [
        { pid: process.pid, start: "worker:1" },
        { pid: 42, start: "parent:2" },
      ],
    },
  );
});

it("refuses to record an ancestor whose identity is unavailable", async () => {
  boundary.readFile.mockResolvedValue("99 (worker) S 0 99");
  boundary.identity.mockResolvedValue(null);
  await expect(rememberOwnership("/job")).rejects.toThrow(
    "ownership unavailable",
  );
  expect(boundary.store).not.toHaveBeenCalled();
});

it("counts only the account's threads and tolerates vanished or inaccessible processes", async () => {
  const userId = process.getuid?.();
  if (userId === undefined) throw new Error("User ID unavailable");
  boundary.readdir.mockResolvedValue(["1", "2", "3", "4", "self"]);
  boundary.readFile
    .mockResolvedValueOnce(`Uid: ${userId}\nThreads: 4\n`)
    .mockResolvedValueOnce("Uid: 99999999\nThreads: 7\n")
    .mockRejectedValueOnce({ code: "ENOENT" })
    .mockRejectedValueOnce({ code: "EACCES" });
  expect(await accountTasks()).toBe(4);
  expect(boundary.readFile).toHaveBeenCalledTimes(4);
});

it("propagates unexpected process scan failures", async () => {
  boundary.readdir.mockResolvedValue(["1"]);
  boundary.readFile.mockRejectedValue({ code: "EIO" });
  await expect(accountTasks()).rejects.toMatchObject({ code: "EIO" });
});

it("confirms an unstarted launch only when its claim and ownership match", async () => {
  const launch = {
    boundary: "not_started",
    jobId: "job",
    sessionId: "s",
    attemptId: "a",
  };
  boundary.readOwnedLaunch.mockResolvedValue(launch);
  boundary.readRecord.mockResolvedValue({
    jobId: "job",
    sessionId: "s",
    plan: { attemptId: "a" },
  });
  expect(await cleanup("/job", "job")).toBe("confirmed");
  const onFailure = vi.fn();
  boundary.readRecord.mockResolvedValue({ jobId: "job", sessionId: "other" });
  expect(await cleanup("/job", "job", { onFailure })).toBe("failed");
  expect(onFailure).toHaveBeenCalledWith("process_scan_unavailable");
  expect(boundary.rm).not.toHaveBeenCalled();
});

it("refuses missing job identities and legacy launches", async () => {
  const onFailure = vi.fn();
  expect(await cleanup("/job", "", { onFailure })).toBe("failed");
  boundary.readOwnedLaunch.mockResolvedValue(null);
  expect(await cleanup("/job", "job", { onFailure })).toBe("failed");
  expect(onFailure).toHaveBeenCalledTimes(2);
});

it("cleans runtime files after a supervisor identity disappears", async () => {
  boundary.readOwnedLaunch.mockResolvedValue({
    boundary: "pid_namespace",
    processId: 42,
    identity: "42:old",
  });
  boundary.identity.mockResolvedValue("42:new");
  expect(await cleanup("/job", "job")).toBe("confirmed");
  expect(boundary.cleanupPagesFiles).toHaveBeenCalledWith("/job");
  expect(boundary.rm).toHaveBeenCalledWith("/job/runtime", {
    recursive: true,
    force: true,
  });
});

it("refuses an invalid supervisor identity and denied signals", async () => {
  const onFailure = vi.fn();
  boundary.readOwnedLaunch.mockResolvedValue({
    boundary: "pid_namespace",
    processId: 42,
    identity: "invalid",
  });
  expect(await cleanup("/job", "job", { onFailure })).toBe("failed");
  boundary.readOwnedLaunch.mockResolvedValue({
    boundary: "pid_namespace",
    processId: 42,
    identity: "42:old",
  });
  boundary.identity.mockResolvedValue("42:old");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  expect(await cleanup("/job", "job", { includeWorker: true, onFailure })).toBe(
    "failed",
  );
  expect(onFailure.mock.calls).toEqual([
    ["process_scan_unavailable"],
    ["signal_denied"],
  ]);
});
