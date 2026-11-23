import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";

import type * as FileSystem from "node:fs/promises";
import type * as OperatingSystem from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

const statfsMock = vi.hoisted(() => ({ type: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    statfs: (target: string) =>
      statfsMock.type === 0
        ? original.statfs(target)
        : Promise.resolve({ type: statfsMock.type }),
  };
});

const homeMock = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof OperatingSystem>();
  return {
    ...original,
    homedir: () => homeMock.directory || original.homedir(),
  };
});

const {
  planTemporaryDirectory,
  planTemporaryEnvironment,
  planTemporaryMountDirectory,
  planTemporaryRoot,
  preparePlanTemporaryDirectory,
  removePlanTemporaryRun,
  removePlanTemporaryStep,
  temporaryPlanRunIds,
} = await import("@/backend/agents/PlanRunTemporaryDirectory");

let home = "";

beforeEach(async () => {
  await mkdir(pagesTempDirectory("plan-run-temporary"), { recursive: true });
  home = await mkdtemp(pagesTempDirectory("plan-run-temporary", "home-"));
  homeMock.directory = home;
  statfsMock.type = 0;
});

afterEach(async () => {
  homeMock.directory = "";
  await rm(home, { recursive: true, force: true });
});

describe("paths", () => {
  it("resolves the scratch root and the step directories", () => {
    const scope = { runId: "run/1", stepId: "step" };

    expect(planTemporaryRoot()).toBe(
      path.join(home, ".pages", "data", "run-tmp"),
    );
    expect(planTemporaryDirectory(scope)).toBe(
      path.join(planTemporaryRoot(), "run%2F1", "step"),
    );
    expect(planTemporaryMountDirectory(scope)).toBe(
      path.join(planTemporaryDirectory(scope), "tmp"),
    );
  });

  it.each(["", ".", ".."])("rejects the identifier %j", (identifier) => {
    expect(() =>
      planTemporaryDirectory({ runId: identifier, stepId: "s" }),
    ).toThrow("Invalid plan temporary directory identifier");
  });

  it("names temp variables with a default and an explicit directory", () => {
    expect(planTemporaryEnvironment()).toEqual({
      TMPDIR: "/tmp",
      TEMP: "/tmp",
      TMP: "/tmp",
      NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
    });
    expect(planTemporaryEnvironment("/x").TMPDIR).toBe("/x");
  });
});

describe("preparePlanTemporaryDirectory", () => {
  const scope = { runId: "run", stepId: "step" };

  it("creates private directories and returns the mount", async () => {
    const mount = await preparePlanTemporaryDirectory(scope);

    expect(mount).toBe(planTemporaryMountDirectory(scope));
    expect((await stat(mount)).mode & 0o777).toBe(0o700);
    // A second call reuses the existing directories.
    await expect(preparePlanTemporaryDirectory(scope)).resolves.toBe(mount);
  });

  it.each([0x01021994, 0x858458f6])(
    "refuses memory backed filesystem type %i",
    async (type) => {
      statfsMock.type = type;

      await expect(preparePlanTemporaryDirectory(scope)).rejects.toThrow(
        "must reside on disk",
      );
    },
  );

  it("refuses a root that is a symbolic link", async () => {
    const target = path.join(home, "target");
    await mkdir(target);
    await mkdir(path.join(home, ".pages", "data"), { recursive: true });
    await symlink(target, planTemporaryRoot());

    await expect(preparePlanTemporaryDirectory(scope)).rejects.toThrow(
      "ownership could not be confirmed",
    );
  });
});

describe("removal and listing", () => {
  it("lists nothing when the root is missing", async () => {
    await expect(temporaryPlanRunIds()).resolves.toEqual([]);
  });

  it("lists run directories and decodes their names", async () => {
    await preparePlanTemporaryDirectory({ runId: "a/b", stepId: "s" });
    await mkdir(planTemporaryRoot(), { recursive: true });

    await expect(temporaryPlanRunIds()).resolves.toEqual(["a/b"]);
  });

  it("rethrows other read errors", async () => {
    await mkdir(path.join(home, ".pages", "data"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(planTemporaryRoot(), "file");

    await expect(temporaryPlanRunIds()).rejects.toThrow();
  });

  it("removes one step and then the whole run", async () => {
    const first = { runId: "run", stepId: "one" };
    const second = { runId: "run", stepId: "two" };
    await preparePlanTemporaryDirectory(first);
    await preparePlanTemporaryDirectory(second);

    await removePlanTemporaryStep(first);
    await expect(stat(planTemporaryDirectory(first))).rejects.toThrow();
    await expect(stat(planTemporaryDirectory(second))).resolves.toBeDefined();

    await removePlanTemporaryRun("run");
    await expect(temporaryPlanRunIds()).resolves.toEqual([]);
  });
});
