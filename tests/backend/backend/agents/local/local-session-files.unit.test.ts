import { constants } from "node:fs";

import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  lstat: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  randomUUID: vi.fn(() => "record-id"),
}));

vi.mock("node:fs/promises", () => mocks);
vi.mock("node:crypto", () => ({ randomUUID: mocks.randomUUID }));

import {
  readLocalRecord,
  requireLocalDirectory,
  writeLocalRecord,
} from "@/backend/agents/local/LocalSessionFiles";

const uid = process.getuid?.();
const directoryStats = { isDirectory: () => true, uid, mode: 0o700 };
const fileStats = { isFile: () => true, uid, mode: 0o600, size: 2 };

interface FileHandleStub {
  sync: Mock;
  close: Mock;
  writeFile: Mock;
  stat: Mock;
  readFile: Mock;
}

function handle(): FileHandleStub {
  return {
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(fileStats),
    readFile: vi.fn().mockResolvedValue("{}"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.lstat.mockResolvedValue(directoryStats);
  mocks.rename.mockResolvedValue(undefined);
  mocks.open.mockImplementation(async () => handle());
});

it("creates and syncs a private directory without following its parent symlink", async () => {
  const parent = handle();
  mocks.open.mockResolvedValue(parent);
  await requireLocalDirectory("/private/session");
  expect(mocks.mkdir).toHaveBeenCalledWith("/private/session", {
    recursive: true,
    mode: 0o700,
  });
  expect(mocks.open).toHaveBeenCalledWith(
    "/private",
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  expect(parent.sync).toHaveBeenCalledOnce();
  expect(parent.close).toHaveBeenCalledOnce();
});

it.each([
  { ...directoryStats, isDirectory: () => false },
  { ...directoryStats, uid: -1 },
  { ...directoryStats, mode: 0o755 },
])("rejects a directory that is not private", async (stats) => {
  mocks.lstat.mockResolvedValue(stats);
  await expect(requireLocalDirectory("/private/session")).rejects.toThrow(
    "not private",
  );
  expect(mocks.open).not.toHaveBeenCalled();
});

it("writes, syncs and renames a private record before syncing its directory", async () => {
  const parent = handle();
  const record = handle();
  const directory = handle();
  mocks.open
    .mockResolvedValueOnce(parent)
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce(directory);
  await writeLocalRecord("/private/session/control", { state: "ready" });
  expect(mocks.open).toHaveBeenNthCalledWith(
    2,
    "/private/session/control.record-id.pending",
    "wx",
    0o600,
  );
  expect(record.writeFile).toHaveBeenCalledWith('{"state":"ready"}');
  expect(record.sync).toHaveBeenCalledOnce();
  expect(record.close).toHaveBeenCalledOnce();
  expect(mocks.rename).toHaveBeenCalledWith(
    "/private/session/control.record-id.pending",
    "/private/session/control",
  );
  expect(directory.sync).toHaveBeenCalledOnce();
  expect(directory.close).toHaveBeenCalledOnce();
});

it("closes a record and does not publish it when writing fails", async () => {
  const record = handle();
  record.writeFile.mockRejectedValue(new Error("disk full"));
  mocks.open.mockResolvedValueOnce(handle()).mockResolvedValueOnce(record);
  await expect(
    writeLocalRecord("/private/session/control", {}),
  ).rejects.toThrow("disk full");
  expect(record.close).toHaveBeenCalledOnce();
  expect(mocks.rename).not.toHaveBeenCalled();
});

it("reads a private JSON record without following a symlink", async () => {
  const record = handle();
  record.readFile.mockResolvedValue('{"ready":true}');
  mocks.open.mockResolvedValue(record);
  await expect(readLocalRecord("/private/control")).resolves.toEqual({
    ready: true,
  });
  expect(mocks.open).toHaveBeenCalledWith(
    "/private/control",
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  expect(record.close).toHaveBeenCalledOnce();
});

it.each([
  { ...fileStats, isFile: () => false },
  { ...fileStats, uid: -1 },
  { ...fileStats, mode: 0o644 },
  { ...fileStats, size: 2 * 1024 * 1024 + 1 },
])("rejects invalid control records and closes the handle", async (stats) => {
  const record = handle();
  record.stat.mockResolvedValue(stats);
  mocks.open.mockResolvedValue(record);
  await expect(readLocalRecord("/private/control")).rejects.toThrow(
    "Invalid local session control file",
  );
  expect(record.readFile).not.toHaveBeenCalled();
  expect(record.close).toHaveBeenCalledOnce();
});

it("rejects a record that grows beyond the limit after stat", async () => {
  const record = handle();
  record.readFile.mockResolvedValue("x".repeat(2 * 1024 * 1024 + 1));
  mocks.open.mockResolvedValue(record);
  await expect(readLocalRecord("/private/control")).rejects.toThrow(
    "too large",
  );
  expect(record.close).toHaveBeenCalledOnce();
});

it("closes the parent directory when synchronization fails", async () => {
  const parent = handle();
  parent.sync.mockRejectedValue(new Error("sync failed"));
  mocks.open.mockResolvedValue(parent);
  await expect(requireLocalDirectory("/private/session")).rejects.toThrow(
    "sync failed",
  );
  expect(parent.close).toHaveBeenCalledOnce();
});

it("closes a control record when its JSON is invalid", async () => {
  const record = handle();
  record.readFile.mockResolvedValue("{");
  mocks.open.mockResolvedValue(record);
  await expect(readLocalRecord("/private/control")).rejects.toThrow(
    SyntaxError,
  );
  expect(record.close).toHaveBeenCalledOnce();
});
