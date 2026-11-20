import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { SshRuntimeDirectory } from "./SshRuntimeDirectory";

import type * as FileSystem from "node:fs/promises";

const removal = vi.hoisted(() => ({ fail: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    rm: async (...parameters: Parameters<typeof original.rm>) => {
      if (removal.fail) throw new Error("removal failed");
      return original.rm(...parameters);
    },
  };
});
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

it("creates private scopes, removes secrets and disposes the root", async () => {
  const parent = pagesTempDirectory("ssh-runtime-tests");
  await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, "case-"));
  const runtime = new SshRuntimeDirectory(base);
  try {
    const first = await runtime.createScope();
    const second = await runtime.createScope();
    expect(first.directory).not.toBe(second.directory);
    expect(first.askpass).toBe(second.askpass);
    expect((await stat(first.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(first.askpass)).mode & 0o777).toBe(0o700);
    expect(await readFile(first.askpass, "utf8")).toContain("PAGES_SSH_SECRET");
    const key = await first.write("key", "private");
    expect(await readFile(key, "utf8")).toBe("private");
    expect((await stat(key)).mode & 0o777).toBe(0o600);
    await first.discard("key");
    await expect(stat(key)).rejects.toMatchObject({ code: "ENOENT" });
    await first.remove();
    await expect(stat(first.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await runtime.dispose();
    await expect(stat(second.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await runtime.dispose();
  } finally {
    await runtime.dispose();
    await rm(base, { recursive: true, force: true });
  }
});

it("retries root creation after a missing base is created", async () => {
  const parent = pagesTempDirectory("ssh-runtime-tests");
  await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, "case-"));
  const missing = path.join(base, "missing");
  const runtime = new SshRuntimeDirectory(missing);
  try {
    await expect(runtime.createScope()).rejects.toMatchObject({
      code: "ENOENT",
    });
    await mkdir(missing);
    const scope = await runtime.createScope();
    expect(await stat(scope.directory)).toBeDefined();
  } finally {
    await runtime.dispose();
    await rm(base, { recursive: true, force: true });
  }
});

it("handles a failed cleanup without rejecting shutdown", async () => {
  const parent = pagesTempDirectory("ssh-runtime-tests");
  await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, "case-"));
  const runtime = new SshRuntimeDirectory(base);
  try {
    const scope = await runtime.createScope();
    removal.fail = true;
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(await stat(scope.directory)).toBeDefined();
  } finally {
    removal.fail = false;
    await rm(base, { recursive: true, force: true });
  }
});
