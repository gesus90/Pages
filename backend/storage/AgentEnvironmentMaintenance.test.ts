import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { AgentEnvironmentMaintenance } from "./AgentEnvironmentMaintenance";

import type { PlanHomeDisposition } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";

const removable = "12345678-1234-1234-1234-123456789abc";
const retained = "abcdefab-1234-1234-1234-123456789abc";
let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("agent-maintenance-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("cleans eligible homes and caches while preserving credentials and linked caches", async () => {
  const connection = path.join(directory, "agents", "connection");
  const home = path.join(connection, "home");
  const scope = path.join(connection, "plan-homes", retained, "a".repeat(64));
  const outside = path.join(directory, "outside");
  await mkdir(path.join(home, "cache", "pnpm"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "kept"), "safe");
  await symlink(outside, path.join(home, ".npm"));
  for (const folder of ["home", "claude", "work"]) {
    await mkdir(path.join(scope, folder), { recursive: true });
    await writeFile(path.join(scope, folder, "old"), "old");
  }
  await writeFile(path.join(scope, "claude", ".credentials.json"), "secret");
  for (const id of [removable, retained]) {
    await mkdir(path.join(connection, "plan-sessions", id), {
      recursive: true,
    });
  }
  await mkdir(path.join(connection, "plan-homes", removable), {
    recursive: true,
  });
  const repository = {
    purgeObsoleteRuns: vi.fn(async () => {}),
    canRemoveRun: vi.fn(async (id: string) => id === removable),
    maintainConnectionCaches: vi.fn(async (maintain: () => Promise<void>) =>
      maintain(),
    ),
    maintainPlan: vi.fn(
      async (
        id: string,
        maintain: (disposition: PlanHomeDisposition) => Promise<void>,
      ) => {
        await maintain(id === removable ? "remove" : "empty");
      },
    ),
  };
  await new AgentEnvironmentMaintenance(directory, repository).run();
  expect(repository.purgeObsoleteRuns).toHaveBeenCalledOnce();
  expect(await readdir(path.join(connection, "plan-sessions"))).toEqual([
    retained,
  ]);
  expect(await readdir(path.join(connection, "plan-homes"))).toEqual([
    retained,
  ]);
  expect(await readdir(path.join(scope, "home"))).toEqual([]);
  expect(await readdir(path.join(scope, "work"))).toEqual([]);
  expect(await readdir(path.join(scope, "claude"))).toEqual([
    ".credentials.json",
  ]);
  expect(await readFile(path.join(outside, "kept"), "utf8")).toBe("safe");
  await expect(readdir(path.join(home, "cache", "pnpm"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});

it("leaves active plans, invalid names and linked homes untouched", async () => {
  const agents = path.join(directory, "agents");
  const connection = path.join(agents, "connection");
  const homes = path.join(connection, "plan-homes");
  const sessions = path.join(connection, "plan-sessions");
  const outside = path.join(directory, "outside");
  await mkdir(path.join(homes, retained, "not-a-scope", "home"), {
    recursive: true,
  });
  await mkdir(path.join(homes, "not-a-plan"), { recursive: true });
  await mkdir(path.join(sessions, "not-a-run"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "safe"), "safe");
  await symlink(outside, path.join(homes, removable));
  await symlink(outside, path.join(agents, "linked-connection"));
  await writeFile(path.join(agents, "not-a-directory"), "file");
  const repository = {
    purgeObsoleteRuns: vi.fn(async () => {}),
    canRemoveRun: vi.fn(async () => false),
    maintainConnectionCaches: vi.fn(async (maintain: () => Promise<void>) =>
      maintain(),
    ),
    maintainPlan: vi.fn(
      async (
        id: string,
        maintain: (disposition: PlanHomeDisposition) => Promise<void>,
      ) => {
        expect(id).toBe(retained);
        await maintain("keep");
      },
    ),
  };
  await new AgentEnvironmentMaintenance(directory, repository).run();
  expect(repository.maintainPlan).toHaveBeenCalledOnce();
  expect(repository.canRemoveRun).not.toHaveBeenCalled();
  expect(await readdir(homes)).toEqual(
    expect.arrayContaining([retained, removable, "not-a-plan"]),
  );
  expect(await readdir(path.join(homes, retained))).toEqual(["not-a-scope"]);
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("safe");
});

it("empties only valid physical scopes and leaves linked cache targets untouched", async () => {
  const connection = path.join(directory, "agents", "connection");
  const home = path.join(connection, "home");
  const plan = path.join(connection, "plan-homes", retained);
  const scope = path.join(plan, "a".repeat(64));
  const invalid = path.join(plan, "wrong-scope");
  const outside = path.join(directory, "outside");
  await mkdir(path.join(home, "cache"), { recursive: true });
  await mkdir(scope, { recursive: true });
  await mkdir(invalid);
  await mkdir(outside);
  await writeFile(path.join(outside, "safe"), "safe");
  await writeFile(path.join(invalid, "safe"), "safe");
  await writeFile(path.join(scope, "home"), "not a directory");
  await mkdir(path.join(scope, "work"));
  await writeFile(path.join(scope, "work", "old"), "old");
  await symlink(outside, path.join(scope, "claude"));
  await symlink(outside, path.join(home, "cache", "pnpm"));
  await writeFile(path.join(plan, "b".repeat(64)), "not a scope");
  const repository = {
    purgeObsoleteRuns: vi.fn(async () => {}),
    canRemoveRun: vi.fn(async () => false),
    maintainConnectionCaches: vi.fn(async (maintain: () => Promise<void>) =>
      maintain(),
    ),
    maintainPlan: vi.fn(
      async (
        planId: string,
        maintain: (disposition: PlanHomeDisposition) => Promise<void>,
      ) => {
        expect(planId).toBe(retained);
        await maintain("empty");
      },
    ),
  };
  await new AgentEnvironmentMaintenance(directory, repository).run();
  expect(await readdir(path.join(scope, "work"))).toEqual([]);
  expect(await readFile(path.join(scope, "home"), "utf8")).toBe(
    "not a directory",
  );
  expect(await readFile(path.join(invalid, "safe"), "utf8")).toBe("safe");
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("safe");
  expect(await readdir(path.join(home, "cache"))).toEqual(["pnpm"]);
});
