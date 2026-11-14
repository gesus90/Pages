import { beforeEach, expect, it, vi } from "vitest";

import {
  prepareRunnerTemporaryDirectory,
  removeRunnerTemporaryDirectory,
  runnerTemporaryDirectory,
} from "@/scripts/runner/temporary.mjs";
import { cleanup } from "@/scripts/runner/processes.mjs";

const boundary = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  lstat: vi.fn(async () => ({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
  })),
  statfs: vi.fn(async () => ({ type: 0xef53 })),
  rm: vi.fn(async () => undefined),
  rmdir: vi.fn(async () => undefined),
  readdir: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
  identity: vi.fn(async () => null),
  readRecord: vi.fn(),
  readOwnedLaunch: vi.fn(),
  store: vi.fn(),
  cleanupPagesFiles: vi.fn(async () => undefined),
}));
vi.mock("node:fs/promises", () => boundary);
vi.mock("node:os", () => ({ userInfo: () => ({ homedir: "/disk/account" }) }));
vi.mock("@/scripts/runner/journal.mjs", () => boundary);
vi.mock("@/scripts/runner/pages.mjs", () => boundary);
const JOB = { jobId: "job", plan: { runId: "run", stepId: "checks" } };
const DIRECTORY = "/disk/account/.pages/data/run-tmp/run/checks/remote-job";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAGES_RUNNER_JOB_NAMESPACE", "0");
  boundary.statfs.mockResolvedValue({ type: 0xef53 });
});

it("allocates remote disk scratch under the same run hierarchy", async () => {
  await expect(prepareRunnerTemporaryDirectory(JOB)).resolves.toBe(DIRECTORY);
  expect(boundary.chmod).toHaveBeenCalledWith(DIRECTORY, 0o700);
  expect(runnerTemporaryDirectory({ ...JOB, jobId: "other" })).not.toBe(
    DIRECTORY,
  );
});

it("rejects RAM scratch before a remote namespace starts", async () => {
  boundary.statfs.mockResolvedValue({ type: 0x01021994 });
  await expect(prepareRunnerTemporaryDirectory(JOB)).rejects.toThrow("on disk");
});

it("deletes remote scratch and empty parents only after the supervisor identity is gone", async () => {
  boundary.readOwnedLaunch.mockResolvedValue({
    boundary: "pid_namespace",
    processId: 42,
    identity: "boot:1",
  });
  boundary.readRecord.mockResolvedValue(JOB);
  await expect(cleanup("/runner/jobs/job", "job")).resolves.toBe("confirmed");
  expect(boundary.identity).toHaveBeenCalledWith(42);
  expect(boundary.rm).toHaveBeenCalledWith(DIRECTORY, {
    recursive: true,
    force: true,
  });
  expect(boundary.rmdir).toHaveBeenCalledWith(
    "/disk/account/.pages/data/run-tmp/run",
  );
});

it("retains files when no namespace ownership can be proven", async () => {
  boundary.readOwnedLaunch.mockResolvedValue(null);
  await expect(cleanup("/runner/jobs/job", "job")).resolves.toBe("failed");
  expect(boundary.rm).not.toHaveBeenCalled();
});

it("keeps sibling attempts while pruning empty parents", async () => {
  boundary.rmdir.mockRejectedValue(
    Object.assign(new Error("busy"), { code: "ENOTEMPTY" }),
  );
  await expect(removeRunnerTemporaryDirectory(JOB)).resolves.toBeUndefined();
  expect(boundary.rm).toHaveBeenCalledExactlyOnceWith(DIRECTORY, {
    recursive: true,
    force: true,
  });
});
