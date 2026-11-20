import { beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  lstat: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  rmdir: vi.fn(),
}));
vi.mock("node:fs/promises", () => boundary);

import {
  expireProviderFiles,
  storageBytes,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

const directory = {
  isDirectory: () => true,
  isSymbolicLink: () => false,
  isFile: () => false,
};

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.lstat.mockResolvedValue(directory);
  boundary.readdir.mockResolvedValue([]);
  boundary.rmdir.mockResolvedValue(undefined);
});

it("propagates metadata errors other than a missing path", async () => {
  boundary.lstat.mockRejectedValueOnce(errorWithCode("EACCES"));
  await expect(storageMetadata("/inaccessible")).rejects.toMatchObject({
    code: "EACCES",
  });
});

it("handles a directory disappearing between metadata and listing, but propagates other errors", async () => {
  boundary.readdir
    .mockRejectedValueOnce(errorWithCode("ENOENT"))
    .mockRejectedValueOnce(errorWithCode("EACCES"));
  await expect(storageEntries("/gone")).resolves.toEqual([]);
  await expect(storageEntries("/inaccessible")).rejects.toMatchObject({
    code: "EACCES",
  });
});

it.each(["ENOENT", "ENOTEMPTY", "EEXIST"])(
  "tolerates %s while removing an empty directory",
  async (code) => {
    boundary.rmdir.mockRejectedValueOnce(errorWithCode(code));
    await expect(
      expireProviderFiles("/directory", 100),
    ).resolves.toBeUndefined();
    expect(boundary.rmdir).toHaveBeenCalledWith("/directory");
  },
);

it("propagates unexpected removal failures and ignores non-file entries when counting", async () => {
  boundary.rmdir.mockRejectedValueOnce(errorWithCode("EACCES"));
  await expect(expireProviderFiles("/directory", 100)).rejects.toMatchObject({
    code: "EACCES",
  });
  boundary.lstat.mockResolvedValueOnce({
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isFile: () => false,
  });
  await expect(storageBytes("/socket")).resolves.toBe(0);
});
