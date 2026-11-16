import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type * as NodeFs from "node:fs";

const boundary = vi.hoisted(() => ({
  open: vi.fn(),
  realpath: vi.fn(),
  realpathSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  open: boundary.open,
  realpath: boundary.realpath,
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof NodeFs>()),
  realpathSync: boundary.realpathSync,
}));

import {
  adminPathParts,
  openAdminDirectory,
  PICA_ADMIN_FILE_ROOT,
  requireAdminFileLocation,
  withAdminFile,
} from "@/backend/service/chat/admin/PicaAdminPaths";

import type { FileHandle } from "node:fs/promises";

const close = vi.fn();
const stat = vi.fn();
const handle = { fd: 10, close, stat };

beforeEach(() => {
  vi.resetAllMocks();
  boundary.open.mockResolvedValue(handle);
  stat.mockResolvedValue({
    uid: process.getuid?.(),
    mode: 0o600,
    isFile: () => true,
    nlink: 1,
  });
  boundary.realpath.mockResolvedValue(
    path.join(PICA_ADMIN_FILE_ROOT, "user", "note.txt"),
  );
});

it("accepts safe relative paths and rejects traversal, secrets and unsupported types", () => {
  expect(adminPathParts("folder/notes.txt")).toEqual(["folder", "notes.txt"]);
  expect(adminPathParts("", true)).toEqual([]);
  for (const value of [
    "../notes.txt",
    "/notes.txt",
    ".hidden.txt",
    "password.txt",
    "notes.exe",
    "folder//notes.txt",
    "a".repeat(241),
  ])
    expect(() => adminPathParts(value)).toThrow();
});

it("opens a safe file through descriptors and closes them after work", async () => {
  const work = vi.fn(async () => "done");
  expect(
    await withAdminFile({ userId: "user", relative: "note.txt", work }),
  ).toBe("done");
  expect(work).toHaveBeenCalledWith(handle);
  expect(close.mock.calls.length).toBeGreaterThan(1);
  expect(boundary.open).toHaveBeenCalledWith(
    expect.stringContaining("/proc/self/fd/10/note.txt"),
    expect.any(Number),
  );
});

it("refuses unsafe owners, permissions, links and resolved locations", async () => {
  for (const facts of [
    { uid: -1, mode: 0o600, isFile: () => true, nlink: 1 },
    { uid: process.getuid?.(), mode: 0o622, isFile: () => true, nlink: 1 },
    { uid: process.getuid?.(), mode: 0o600, isFile: () => false, nlink: 1 },
    { uid: process.getuid?.(), mode: 0o600, isFile: () => true, nlink: 2 },
  ]) {
    stat.mockResolvedValue(facts);
    await expect(
      withAdminFile({
        userId: "user",
        relative: "note.txt",
        work: async () => "bad",
      }),
    ).rejects.toThrow();
  }
  stat.mockResolvedValue({
    uid: process.getuid?.(),
    mode: 0o600,
    isFile: () => true,
    nlink: 1,
  });
  boundary.realpath.mockResolvedValue("/outside/note.txt");
  await expect(
    withAdminFile({
      userId: "user",
      relative: "note.txt",
      work: async () => "bad",
    }),
  ).rejects.toThrow();
  await expect(openAdminDirectory("../user", [])).rejects.toThrow();
});

it("checks synchronous I/O against the exact allowed location", () => {
  boundary.realpathSync.mockReturnValue(
    path.join(PICA_ADMIN_FILE_ROOT, "user", "note.txt"),
  );
  expect(() =>
    requireAdminFileLocation(partial<FileHandle>(handle), "user", "note.txt"),
  ).not.toThrow();
  boundary.realpathSync.mockReturnValue("/outside/note.txt");
  expect(() =>
    requireAdminFileLocation(partial<FileHandle>(handle), "user", "note.txt"),
  ).toThrow();
});
