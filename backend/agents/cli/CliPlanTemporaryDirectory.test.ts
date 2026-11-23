import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  activeJobTemporaryIds,
  attachPlanTemporaryDirectory,
  jobTemporaryCleanup,
  jobTemporaryDirectory,
  jobTemporaryMountDirectory,
  jobTemporaryRoot,
  prepareJobTemporaryDirectory,
  releaseJobTemporaryDirectory,
  removeJobTemporaryDirectory,
  usesJobTemporaryDirectory,
} from "@/backend/agents/cli/CliPlanTemporaryDirectory";

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  preparePlanTemporaryDirectory: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  chmod: mocks.chmod,
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  rm: mocks.rm,
}));
vi.mock("@/backend/agents/PlanRunTemporaryDirectory", () => ({
  preparePlanTemporaryDirectory: mocks.preparePlanTemporaryDirectory,
}));
vi.mock("@/backend/config/PagesTempDirectory", () => ({
  pagesTempDirectory: (...parts: string[]) =>
    ["/home/test/.pages/tmp", ...parts].join("/"),
}));

/** Builds a deliberately partial test double typed as the parameter it replaces. */
function stub<T>(value: unknown): T {
  return value as T;
}

type PlanInput = Parameters<typeof attachPlanTemporaryDirectory>[1];
type Worker = Parameters<typeof attachPlanTemporaryDirectory>[0];
type UsageInput = Parameters<typeof usesJobTemporaryDirectory>[0];

function directoryMetadata(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.lstat.mockResolvedValue(directoryMetadata());
});

afterEach(() => {
  for (const id of [...activeJobTemporaryIds()]) {
    releaseJobTemporaryDirectory(id);
  }
});

it("resolves job folders below the Pages temporary folder", () => {
  expect(jobTemporaryRoot()).toBe("/home/test/.pages/tmp/jobs");
  expect(jobTemporaryDirectory("a/b")).toBe("/home/test/.pages/tmp/jobs/a%2Fb");
  expect(jobTemporaryMountDirectory("job")).toBe(
    "/home/test/.pages/tmp/jobs/job/tmp",
  );
});

it.each(["", ".", ".."])("rejects the identifier %j", (identifier) => {
  expect(() => jobTemporaryDirectory(identifier)).toThrow(
    "Invalid job temporary directory identifier",
  );
});

it("creates private folders and counts active jobs", async () => {
  const mount = await prepareJobTemporaryDirectory("job");
  await prepareJobTemporaryDirectory("job");
  expect(mount).toBe("/home/test/.pages/tmp/jobs/job/tmp");
  expect(mocks.mkdir).toHaveBeenCalledWith("/home/test/.pages/tmp/jobs", {
    recursive: true,
    mode: 0o700,
  });
  expect(mocks.chmod).toHaveBeenCalledWith(mount, 0o700);
  expect([...activeJobTemporaryIds()]).toEqual(["job"]);
  releaseJobTemporaryDirectory("job");
  expect([...activeJobTemporaryIds()]).toEqual(["job"]);
  releaseJobTemporaryDirectory("job");
  releaseJobTemporaryDirectory("job");
  expect(activeJobTemporaryIds().size).toBe(0);
});

it.each([
  ["not a directory", { isDirectory: () => false }],
  ["a symbolic link", { isSymbolicLink: () => true }],
  ["owned by someone else", { uid: -1 }],
])("refuses a folder that is %s", async (description, overrides) => {
  mocks.lstat.mockResolvedValue(directoryMetadata(overrides));
  await expect(prepareJobTemporaryDirectory("job")).rejects.toThrow(
    "ownership could not be confirmed",
  );
  expect(activeJobTemporaryIds().size).toBe(0);
});

it("removes a job folder and releases it even when removal fails", async () => {
  await prepareJobTemporaryDirectory("job");
  await removeJobTemporaryDirectory("job");
  expect(mocks.rm).toHaveBeenCalledWith("/home/test/.pages/tmp/jobs/job", {
    recursive: true,
    force: true,
  });
  expect(activeJobTemporaryIds().size).toBe(0);
  await prepareJobTemporaryDirectory("job");
  mocks.rm.mockRejectedValueOnce(new Error("busy"));
  await expect(removeJobTemporaryDirectory("job")).rejects.toThrow("busy");
  expect(activeJobTemporaryIds().size).toBe(0);
});

it("decides which sessions use a job folder", () => {
  expect(usesJobTemporaryDirectory(stub<UsageInput>({ chat: {} }))).toBe(true);
  expect(usesJobTemporaryDirectory({ resourceContext: undefined })).toBe(true);
  expect(
    usesJobTemporaryDirectory(
      stub<UsageInput>({ resourceContext: { runId: "r" } }),
    ),
  ).toBe(false);
});

it("offers cleanup callbacks only for job sessions", async () => {
  expect(
    jobTemporaryCleanup(
      stub<Parameters<typeof jobTemporaryCleanup>[0]>({
        instanceId: "i",
        resourceContext: { runId: "r" },
      }),
    ),
  ).toEqual({});
  const cleanup = jobTemporaryCleanup({ instanceId: "i" });
  await prepareJobTemporaryDirectory("i");
  cleanup.releaseTemporaryDirectory?.();
  expect(activeJobTemporaryIds().size).toBe(0);
  await cleanup.cleanupTemporaryDirectory?.();
  expect(mocks.rm).toHaveBeenCalledTimes(1);
});

it("attaches a plan-step directory with the session scope or step identifier", async () => {
  mocks.preparePlanTemporaryDirectory.mockResolvedValue("/plan/tmp");
  const worker = stub<Worker>({ file: "x" });
  const scoped = await attachPlanTemporaryDirectory(
    worker,
    stub<PlanInput>({
      instanceId: "i",
      resourceContext: { runId: "r", stepId: "s", sessionScopeId: "scope" },
    }),
  );
  const plain = await attachPlanTemporaryDirectory(
    worker,
    stub<PlanInput>({
      instanceId: "i",
      resourceContext: { runId: "r", stepId: "s" },
    }),
  );
  expect(scoped).toEqual({ file: "x", temporaryDirectory: "/plan/tmp" });
  expect(plain.temporaryDirectory).toBe("/plan/tmp");
  expect(mocks.preparePlanTemporaryDirectory).toHaveBeenNthCalledWith(1, {
    runId: "r",
    stepId: "scope",
  });
  expect(mocks.preparePlanTemporaryDirectory).toHaveBeenNthCalledWith(2, {
    runId: "r",
    stepId: "s",
  });
});

it("attaches a job directory for chats and sessions without a plan context", async () => {
  const chat = await attachPlanTemporaryDirectory(
    stub<Worker>({ file: "x" }),
    stub<PlanInput>({
      instanceId: "i",
      chat: {},
      resourceContext: { runId: "r", stepId: "s" },
    }),
  );
  const standalone = await attachPlanTemporaryDirectory(
    stub<Worker>({}),
    stub<PlanInput>({ instanceId: "j" }),
  );
  expect(chat.temporaryDirectory).toBe("/home/test/.pages/tmp/jobs/i/tmp");
  expect(standalone.temporaryDirectory).toBe(
    "/home/test/.pages/tmp/jobs/j/tmp",
  );
  expect(mocks.preparePlanTemporaryDirectory).not.toHaveBeenCalled();
});
