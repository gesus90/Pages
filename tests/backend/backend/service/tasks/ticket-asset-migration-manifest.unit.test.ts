import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PDF_BYTES,
  PDF_FILE,
  PDF_ID,
  PDF_TARGET,
  PNG_BYTES,
  PNG_FILE,
  PNG_ID,
  PNG_TARGET,
  attachment,
  sha256,
  useMigrationWorld,
  world,
} from "./ticket-asset-migration-world";

import type * as FileSystem from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    cp: vi.fn(actual.cp),
    lstat: vi.fn(actual.lstat),
  };
});

useMigrationWorld();

function manifestWith(change: Record<string, unknown>): unknown {
  return {
    directory: world.dataDirectory,
    entries: [{ ...world.validEntry(), ...change }],
  };
}

describe("a backup manifest that is accepted", () => {
  it("matches the current attachments", async () => {
    await world.backupWithManifest({
      directory: world.dataDirectory,
      entries: [
        world.validEntry(),
        {
          ...world.validEntry(),
          id: PDF_ID,
          oldStorageName: PDF_FILE,
          storageName: PDF_TARGET,
          checksum: sha256(PDF_BYTES),
          size: PDF_BYTES.length,
          contentType: "application/pdf",
          kind: "file",
        },
      ],
    });

    expect(await world.service().inspect()).toHaveLength(2);
  });

  it("names an entry that was already an asset path before the backup", async () => {
    await world.backupWithManifest({
      directory: world.dataDirectory,
      entries: [{ ...world.validEntry(), oldStorageName: PNG_TARGET }],
    });
    world.stored = [attachment(PNG_ID, PNG_TARGET, PNG_BYTES)];
    await rm(path.join(world.dataDirectory, "ticket-attachments"), {
      recursive: true,
    });
    await world.writeData(PNG_TARGET, PNG_BYTES);

    const result = await world.service().migrate();

    expect(result.movedCount).toBe(0);
    expect(await readFile(path.join(world.dataDirectory, PNG_TARGET))).toEqual(
      PNG_BYTES,
    );
  });
});

describe("a backup manifest that is refused", () => {
  it.each([
    { description: "JSON null", build: () => null },
    { description: "a missing directory", build: () => ({ entries: [] }) },
    {
      description: "a different data directory",
      build: () => ({ directory: "/elsewhere", entries: [] }),
    },
    {
      description: "entries that are no array",
      build: () => ({ directory: world.dataDirectory, entries: {} }),
    },
    {
      description: "a null entry",
      build: () => ({ directory: world.dataDirectory, entries: [null] }),
    },
    {
      description: "an entry without id",
      build: () => manifestWith({ id: undefined }),
    },
    { description: "a non-string id", build: () => manifestWith({ id: 7 }) },
    {
      description: "a destination that is no asset path",
      build: () => manifestWith({ storageName: PNG_FILE }),
    },
    {
      description: "a non-string destination",
      build: () => manifestWith({ storageName: 7 }),
    },
    {
      description: "an unsafe original name",
      build: () => manifestWith({ oldStorageName: "../x" }),
    },
    {
      description: "a non-string original name",
      build: () => manifestWith({ oldStorageName: 7 }),
    },
    {
      description: "a malformed checksum",
      build: () => manifestWith({ checksum: "abc" }),
    },
    {
      description: "a non-string checksum",
      build: () => manifestWith({ checksum: 7 }),
    },
    {
      description: "a non-string content type",
      build: () => manifestWith({ contentType: 7 }),
    },
    {
      description: "an unknown kind",
      build: () => manifestWith({ kind: "video" }),
    },
    {
      description: "a fractional size",
      build: () => manifestWith({ size: 1.5 }),
    },
    {
      description: "a negative size",
      build: () => manifestWith({ size: -1 }),
    },
    {
      description: "a non-numeric size",
      build: () => manifestWith({ size: "3" }),
    },
  ])("for $description", async ({ build }) => {
    await world.backupWithManifest(build());

    await expect(world.service().inspect()).rejects.toThrow(
      "Invalid migration manifest or different data directory.",
    );
  });

  it("because it is not valid JSON", async () => {
    await mkdir(world.backupDirectory);
    await writeFile(
      path.join(world.backupDirectory, "ticket-assets-manifest.json"),
      "{broken",
    );

    await expect(world.service().inspect()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("because it lists another number of attachments", async () => {
    await world.backupWithManifest({
      directory: world.dataDirectory,
      entries: [world.validEntry()],
    });

    await expect(world.service().inspect()).rejects.toThrow(
      "Attachment count changed since backup; migration aborted.",
    );
  });
});
