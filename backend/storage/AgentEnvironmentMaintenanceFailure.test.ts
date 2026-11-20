import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as FileSystem from "node:fs/promises";

const boundary = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  lstat: boundary.stat,
}));

import { AgentEnvironmentMaintenance } from "./AgentEnvironmentMaintenance";

function repository(): ConstructorParameters<
  typeof AgentEnvironmentMaintenance
>[1] {
  return {
    purgeObsoleteRuns: vi.fn().mockResolvedValue(undefined),
    canRemoveRun: vi.fn().mockResolvedValue(false),
    maintainConnectionCaches: vi.fn(),
    maintainPlan: vi.fn(),
  };
}

it("skips a non-directory agents root", async () => {
  const root = pagesTempDirectory("agent-maintenance-errors");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const filesystem =
    await vi.importActual<typeof FileSystem>("node:fs/promises");
  boundary.stat.mockImplementation(filesystem.lstat);
  const state = repository();
  try {
    await writeFile(path.join(directory, "agents"), "file");
    await new AgentEnvironmentMaintenance(directory, state).run();
    expect(state.purgeObsoleteRuns).toHaveBeenCalledOnce();
    expect(state.maintainConnectionCaches).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("propagates unexpected filesystem failures after purging obsolete runs", async () => {
  const failure = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  boundary.stat.mockRejectedValueOnce(failure);
  const state = repository();
  await expect(
    new AgentEnvironmentMaintenance("/isolated", state).run(),
  ).rejects.toBe(failure);
  expect(state.purgeObsoleteRuns).toHaveBeenCalledOnce();
  expect(state.maintainConnectionCaches).not.toHaveBeenCalled();
});
