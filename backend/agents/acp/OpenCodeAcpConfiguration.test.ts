import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { requireManagedOpenCodeConfiguration } from "@/backend/agents/acp/OpenCodeAcpConfiguration";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as NodeFsPromises from "node:fs/promises";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFsPromises>();
  return { ...original, lstat: vi.fn(original.lstat) };
});
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

let root = "";

beforeEach(async () => {
  await mkdir(pagesTempDirectory("opencode-config-test"), { recursive: true });
  root = await mkdtemp(pagesTempDirectory("opencode-config-test", "case-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function homeOf(home: string): CliHome {
  return { root: home, home, config: home, work: home };
}

it("accepts a home without any configuration", async () => {
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).resolves.toBeUndefined();
});

it("accepts an empty configuration directory", async () => {
  await mkdir(path.join(root, "config", "opencode"), { recursive: true });
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).resolves.toBeUndefined();
});

it("refuses a configuration path that is a file", async () => {
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config", "opencode"), "x");
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});

it("refuses a configuration directory that is a link", async () => {
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "target"));
  await symlink(
    path.join(root, "target"),
    path.join(root, "config", "opencode"),
  );
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});

it("refuses a file the runner would read", async () => {
  await mkdir(path.join(root, "config", "opencode"), { recursive: true });
  await writeFile(path.join(root, "config", "opencode", "AGENTS.md"), "x");
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});

it("refuses a project folder of the runner in the home", async () => {
  await mkdir(path.join(root, ".opencode"));
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});

it("refuses a path that cannot be inspected", async () => {
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config", "opencode"), "x");
  const blocked = path.join(root, "blocked");
  await writeFile(blocked, "x");
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(path.join(blocked, "inner"))),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});

it("refuses a candidate that cannot be inspected", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  vi.mocked(lstat).mockRejectedValueOnce(missing);
  vi.mocked(lstat).mockRejectedValueOnce(new Error("denied"));
  await expect(
    requireManagedOpenCodeConfiguration(homeOf(root)),
  ).rejects.toMatchObject({ code: "opencode_configuration_unmanaged" });
});
