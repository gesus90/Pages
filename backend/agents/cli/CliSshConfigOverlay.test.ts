import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sshConfigOverlayArguments } from "@/backend/agents/cli/CliSshConfigOverlay";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type * as FsPromises from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const fileSystem = vi.hoisted(() => ({
  open: vi.fn<typeof FsPromises.open>(),
  readdir: vi.fn<typeof FsPromises.readdir>(),
  lstat: vi.fn<typeof FsPromises.lstat>(),
  rename: vi.fn<typeof FsPromises.rename>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original: typeof FsPromises = await importOriginal();
  fileSystem.open.mockImplementation(original.open);
  fileSystem.readdir.mockImplementation(original.readdir);
  fileSystem.lstat.mockImplementation(original.lstat);
  fileSystem.rename.mockImplementation(original.rename);
  return { ...original, ...fileSystem };
});
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const actualFs: typeof FsPromises = await vi.importActual("node:fs/promises");
const SYSTEM_FOLDER = "/etc/ssh/ssh_config.d";
let scratch = "";
let system = "";
let parent = "";

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function dropIn(name: string, content = `Host ${name}\n`): Promise<void> {
  await writeFile(path.join(system, name), content);
}

interface FakeHandle {
  readonly stat: () => Promise<unknown>;
  readonly read: (
    buffer: Buffer,
    offset: number,
  ) => Promise<{ bytesRead: number }>;
  readonly close: () => Promise<void>;
}

function fakeHandle(
  metadata: { uid: number; mode: number; size: number },
  chunks: readonly number[],
): FakeHandle {
  const queue = [...chunks];
  return {
    stat: async () => ({ isFile: () => true, ...metadata }),
    read: async (buffer, offset) => {
      const bytesRead = queue.shift() ?? 0;
      buffer.fill(97, offset, Math.min(offset + bytesRead, buffer.length));
      return { bytesRead };
    },
    close: async () => undefined,
  };
}

function useHandle(handle: FakeHandle): void {
  fileSystem.open.mockResolvedValueOnce(handle as unknown as FileHandle);
}

beforeEach(async () => {
  scratch = path.join(
    os.homedir(),
    ".pages",
    "tmp",
    "ssh-overlay",
    randomUUID(),
  );
  system = path.join(scratch, "system");
  parent = path.join(scratch, "copies");
  await mkdir(system, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

it("mounts private copies of the drop-ins in a snapshot named by content", async () => {
  await dropIn("b.conf", "B");
  await dropIn("a.conf", "A");
  await dropIn("ignored.txt");
  await dropIn(".hidden.conf");

  const result = await sshConfigOverlayArguments(parent, system);

  expect(result[0]).toBe("--ro-bind");
  expect(result[2]).toBe(SYSTEM_FOLDER);
  const copies = result[1] ?? "";
  expect(await readdir(copies)).toEqual(["a.conf", "b.conf"]);
  expect(await readFile(path.join(copies, "a.conf"), "utf8")).toBe("A");

  expect(await sshConfigOverlayArguments(parent, system)).toEqual(result);
  expect(await readdir(parent)).toEqual([path.basename(copies)]);
});

it("returns nothing for a missing, empty or unmatched folder", async () => {
  await dropIn("note.txt");
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(
    await sshConfigOverlayArguments(parent, path.join(scratch, "missing")),
  ).toEqual([]);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("reads the system folder by default", async () => {
  fileSystem.readdir.mockRejectedValueOnce(coded("ENOENT"));

  expect(await sshConfigOverlayArguments(parent)).toEqual([]);
  expect(fileSystem.readdir).toHaveBeenCalledWith(SYSTEM_FOLDER);
});

it("logs a folder that cannot be listed", async () => {
  for (const failure of [coded("EIO"), "text", new Error("plain")]) {
    fileSystem.readdir.mockRejectedValueOnce(failure);
    expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  }

  expect(logCaughtError).toHaveBeenCalledTimes(3);
});

it("skips drop-ins that ssh skips and logs other open errors", async () => {
  await symlink(path.join(scratch, "nowhere"), path.join(system, "dead.conf"));
  await symlink(path.join(system, "loop.conf"), path.join(system, "loop.conf"));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await rm(path.join(system, "dead.conf"));
  await rm(path.join(system, "loop.conf"));

  await dropIn("kept.conf", "K");
  for (const code of ["ENOENT", "EACCES", "ELOOP", "ENOTDIR"]) {
    fileSystem.open.mockRejectedValueOnce(coded(code));
    expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  }
  expect(logCaughtError).not.toHaveBeenCalled();

  for (const failure of [coded("EIO"), new Error("plain")]) {
    fileSystem.open.mockRejectedValueOnce(failure);
    expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  }
  expect(logCaughtError).toHaveBeenCalledTimes(2);
});

it("rejects a drop-in that is writable by others, large or no plain file", async () => {
  await dropIn("open.conf");
  await chmod(path.join(system, "open.conf"), 0o666);
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(logDiagnostic).toHaveBeenLastCalledWith(
    "CliSshConfigOverlay",
    "warn",
    expect.stringContaining("open.conf is not a plain file"),
  );

  await chmod(path.join(system, "open.conf"), 0o644);
  await dropIn("open.conf", "x".repeat(1_048_577));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  await rm(path.join(system, "open.conf"));
  await mkdir(path.join(system, "folder.conf"));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(logDiagnostic).toHaveBeenCalledTimes(3);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("trusts a file of root and rejects one of a stranger", async () => {
  await dropIn("root.conf");
  useHandle(fakeHandle({ uid: 0, mode: 0o644, size: 3 }, [2, 1]));
  const trusted = await sshConfigOverlayArguments(parent, system);
  expect(trusted[0]).toBe("--ro-bind");
  expect(await readFile(path.join(trusted[1] ?? "", "root.conf"), "utf8")).toBe(
    "aaa",
  );

  useHandle(fakeHandle({ uid: 4_000_000, mode: 0o644, size: 3 }, [3]));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(logDiagnostic).toHaveBeenCalledTimes(1);
});

it("rejects a drop-in that changed while it was read", async () => {
  await dropIn("grow.conf");
  useHandle(fakeHandle({ uid: 0, mode: 0o644, size: 3 }, [5]));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  useHandle(fakeHandle({ uid: 0, mode: 0o644, size: 3 }, [1]));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(logDiagnostic).toHaveBeenCalledTimes(2);
});

it("refuses a copy folder that is not private", async () => {
  await dropIn("a.conf");
  await mkdir(parent, { mode: 0o700 });
  await chmod(parent, 0o777);
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  await chmod(parent, 0o700);
  fileSystem.lstat.mockImplementationOnce(async (file) => {
    const metadata = await actualFs.lstat(file);
    return Object.assign(metadata, { uid: 4_000_000 });
  });
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  const linked = path.join(scratch, "linked");
  await symlink(parent, linked);
  expect(await sshConfigOverlayArguments(linked, system)).toEqual([]);
  expect(logCaughtError).toHaveBeenCalledTimes(3);
});

async function publishedCopy(): Promise<string> {
  const result = await sshConfigOverlayArguments(parent, system);
  return result[1] ?? "";
}

it("replaces nothing when a published folder is damaged, and logs it", async () => {
  await dropIn("a.conf", "A");
  const copies = await publishedCopy();

  await writeFile(path.join(copies, "extra.conf"), "x");
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await rm(path.join(copies, "extra.conf"));

  await chmod(path.join(copies, "a.conf"), 0o666);
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await chmod(path.join(copies, "a.conf"), 0o644);
  await writeFile(path.join(copies, "a.conf"), "changed");
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  await rm(path.join(copies, "a.conf"));
  await mkdir(path.join(copies, "a.conf"));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);

  expect(logCaughtError).toHaveBeenCalledTimes(4);
  expect((await readdir(parent)).every((name) => !name.startsWith("."))).toBe(
    true,
  );
});

it("rejects a published copy owned by another account", async () => {
  await dropIn("a.conf", "A");
  const copies = await publishedCopy();
  fileSystem.lstat.mockImplementation(async (file) => {
    const metadata = await actualFs.lstat(file);
    if (file === path.join(copies, "a.conf"))
      Object.assign(metadata, { uid: 4_000_000 });
    return metadata;
  });

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
});

it("accepts a snapshot another start published at the same time", async () => {
  await dropIn("a.conf", "A");
  fileSystem.rename.mockImplementationOnce(async (from, to) => {
    await actualFs.rename(from, to);
    return Promise.reject(coded("ENOTEMPTY"));
  });

  const result = await sshConfigOverlayArguments(parent, system);

  expect(result[0]).toBe("--ro-bind");
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("logs a failure to write the copies", async () => {
  await dropIn("a.conf", "A");
  fileSystem.rename.mockRejectedValueOnce(coded("EXDEV"));

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(logCaughtError).toHaveBeenCalledTimes(1);
  expect(
    (await readdir(parent)).filter((name) => name.startsWith(".staging-")),
  ).toEqual([]);
});
