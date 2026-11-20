import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { collectStream } from "./StreamBytes";
import { FileTooLargeError, WikiFileStore } from "./WikiFileStore";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logFileProbeError: vi.fn(),
}));

let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("wiki-store-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("stores, hashes, reads ranges, copies and removes files", async () => {
  const store = new WikiFileStore(path.join(directory, "source"));
  const targetDirectory = path.join(directory, "target");
  const target = new WikiFileStore(targetDirectory);
  const limitFor = vi.fn(() => 20);
  const stored = await store.write(
    Readable.from([Buffer.from("hello world")]),
    {
      absoluteLimit: 20,
      limitFor,
    },
  );
  expect(stored.size).toBe(11);
  expect(stored.checksum).toBe(
    createHash("sha256").update("hello world").digest("hex"),
  );
  expect(limitFor).toHaveBeenCalledWith(Buffer.from("hello world"));
  expect(
    await collectStream(
      store.open(`../${stored.storageName}`, { start: 6, end: 10 }),
      5,
    ),
  ).toEqual(Buffer.from("world"));
  const copied = await store.copyTo(stored.storageName, target);
  expect(await readFile(path.join(targetDirectory, copied), "utf8")).toBe(
    "hello world",
  );
  await store.remove([stored.storageName, "missing"]);
  await expect(
    readFile(path.join(directory, "source", stored.storageName)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(store.copyTo(stored.storageName, target)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readdir(targetDirectory)).toEqual([copied]);
});

it("enforces the absolute limit and the content limit without leaving partial files", async () => {
  const store = new WikiFileStore(directory);
  await expect(
    store.write(Readable.from([Buffer.from("abc")]), {
      absoluteLimit: 2,
      limitFor: () => 10,
    }),
  ).rejects.toBeInstanceOf(FileTooLargeError);
  await expect(
    store.write(Readable.from([Buffer.from("abc")]), {
      absoluteLimit: 10,
      limitFor: () => 2,
    }),
  ).rejects.toBeInstanceOf(FileTooLargeError);
  await expect(
    store.write(Readable.from([Buffer.alloc(4096), Buffer.from("x")]), {
      absoluteLimit: 5000,
      limitFor: () => 4096,
    }),
  ).rejects.toBeInstanceOf(FileTooLargeError);
  expect(await readdir(directory)).toEqual([]);
});

it("sweeps only old unknown files and tolerates a missing directory", async () => {
  const store = new WikiFileStore(directory);
  const options = { absoluteLimit: 10, limitFor: () => 10 };
  const old = await store.write(Readable.from([Buffer.from("old")]), options);
  const known = await store.write(
    Readable.from([Buffer.from("known")]),
    options,
  );
  const recent = await store.write(
    Readable.from([Buffer.from("new")]),
    options,
  );
  await utimes(path.join(directory, old.storageName), 1, 1);
  await utimes(path.join(directory, known.storageName), 1, 1);
  expect(await store.sweep(new Set([known.storageName]), 10000)).toBe(1);
  expect((await readdir(directory)).sort()).toEqual(
    [known.storageName, recent.storageName].sort(),
  );
  expect(
    await new WikiFileStore(path.join(directory, "missing")).sweep(
      new Set(),
      0,
    ),
  ).toBe(0);
});

it("accepts a complete long file and opens it without a range", async () => {
  const store = new WikiFileStore(directory);
  const content = Buffer.alloc(4097, 97);
  const limitFor = vi.fn(() => 4097);
  const stored = await store.write(Readable.from([content]), {
    absoluteLimit: 5000,
    limitFor,
  });
  expect(limitFor).toHaveBeenCalledExactlyOnceWith(content.subarray(0, 4096));
  expect(await collectStream(store.open(stored.storageName), 4097)).toEqual(
    content,
  );
});
