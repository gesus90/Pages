import { beforeEach, expect, it, vi } from "vitest";

import {
  planTemporaryDirectory,
  preparePlanTemporaryDirectory,
  removePlanTemporaryStep,
  temporaryPlanRunIds,
} from "@/backend/agents/PlanRunTemporaryDirectory";

vi.mock("node:os", () => ({ homedir: () => "/disk/account" }));
const filesystem = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  lstat: vi.fn(async () => ({
    isDirectory: (): boolean => true,
    isSymbolicLink: (): boolean => false,
    uid: process.getuid?.(),
  })),
  statfs: vi.fn(async () => ({ type: 0xef53 })),
  rm: vi.fn(async () => undefined),
  readdir: vi.fn(),
}));
vi.mock("node:fs/promises", () => filesystem);

const SCOPE = { runId: "run", stepId: "checks" };

beforeEach(() => {
  vi.clearAllMocks();
  filesystem.lstat.mockResolvedValue({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
  });
  filesystem.statfs.mockResolvedValue({ type: 0xef53 });
});

it("creates private disk scratch for a run and step and reuses its path on resume", async () => {
  const directory = await preparePlanTemporaryDirectory(SCOPE);
  expect(directory).toBe("/disk/account/.pages/data/run-tmp/run/checks/tmp");
  expect(await preparePlanTemporaryDirectory(SCOPE)).toBe(directory);
  expect(filesystem.mkdir).toHaveBeenCalledWith(directory, {
    recursive: true,
    mode: 0o700,
  });
  expect(filesystem.chmod).toHaveBeenCalledWith(directory, 0o700);
  expect(filesystem.rm).not.toHaveBeenCalled();
  expect(planTemporaryDirectory({ ...SCOPE, stepId: "other" })).not.toBe(
    directory,
  );
});

it.each([0x01021994, 0x858458f6])(
  "refuses a RAM filesystem %i",
  async (type) => {
    filesystem.statfs.mockResolvedValue({ type });
    await expect(preparePlanTemporaryDirectory(SCOPE)).rejects.toThrow(
      "on disk",
    );
  },
);

it("refuses an existing symlink instead of following it", async () => {
  filesystem.lstat.mockResolvedValue({
    isDirectory: () => true,
    isSymbolicLink: () => true,
    uid: process.getuid?.(),
  });
  await expect(preparePlanTemporaryDirectory(SCOPE)).rejects.toThrow(
    "ownership",
  );
});

it("keeps hostile step names inside one path segment", async () => {
  expect(
    planTemporaryDirectory({ ...SCOPE, stepId: "../../other" }).endsWith(
      "/..%2F..%2Fother",
    ),
  ).toBe(true);
  await removePlanTemporaryStep(SCOPE);
  expect(filesystem.rm).toHaveBeenCalledWith(planTemporaryDirectory(SCOPE), {
    recursive: true,
    force: true,
  });
});

it("handles missing scratch at startup", async () => {
  filesystem.readdir.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  await expect(temporaryPlanRunIds()).resolves.toEqual([]);
});
