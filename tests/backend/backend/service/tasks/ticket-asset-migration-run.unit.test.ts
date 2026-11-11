import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PDF_FILE,
  PDF_TARGET,
  PNG_BYTES,
  PNG_FILE,
  PNG_ID,
  PNG_TARGET,
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

describe("migrate", () => {
  it("backs up, copies, switches the metadata and removes the originals", async () => {
    const result = await world.service().migrate();

    expect(result).toMatchObject({
      attachmentCount: 2,
      movedCount: 2,
      backupDirectory: world.backupDirectory,
    });
    expect(result.entries.map((entry) => entry.storageName)).toEqual([
      PNG_TARGET,
      PDF_TARGET,
    ]);
    expect(world.stored.map((row) => row.storageName)).toEqual([
      PNG_TARGET,
      PDF_TARGET,
    ]);
    expect(world.stored.map((row) => [row.contentType, row.kind])).toEqual([
      ["image/png", "media"],
      ["application/pdf", "file"],
    ]);
    expect(await readFile(path.join(world.dataDirectory, PNG_TARGET))).toEqual(
      PNG_BYTES,
    );
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([]);
    expect(world.repository.relocate).toHaveBeenCalledTimes(1);
  });

  it("keeps the database dump, a full data copy and the manifest in the backup", async () => {
    await world.service().migrate();

    expect(world.backupDatabase).toHaveBeenCalledWith(world.backupDirectory);
    expect(await world.names(world.backupDirectory)).toEqual([
      "data",
      "database.dump",
      "ticket-assets-manifest.json",
    ]);
    expect(
      await readFile(
        path.join(
          world.backupDirectory,
          "data",
          "ticket-attachments",
          PNG_FILE,
        ),
      ),
    ).toEqual(PNG_BYTES);
    const manifest = await world.manifestFile();
    expect(manifest.directory).toBe(world.dataDirectory);
    expect(manifest.entries.map((entry) => entry.oldStorageName)).toEqual([
      PNG_FILE,
      PDF_FILE,
    ]);
    expect(world.repository.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when an inconsistency is found first", async () => {
    await world.writeData("assets/stray.txt", Buffer.from("stray"));

    await expect(world.service().migrate()).rejects.toThrow(
      "Files without attachment records (not deleted): assets/stray.txt",
    );

    expect(await world.names(world.scratch)).toEqual(["data"]);
    expect(world.backupDatabase).not.toHaveBeenCalled();
    expect(world.repository.relocate).not.toHaveBeenCalled();
  });

  it("refuses a backup folder that already exists without a manifest", async () => {
    await mkdir(world.backupDirectory);

    await expect(world.service().migrate()).rejects.toMatchObject({
      code: "EEXIST",
    });

    expect(world.backupDatabase).not.toHaveBeenCalled();
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([PNG_FILE, PDF_FILE].sort());
  });
});

describe("migrate leftovers and no-op runs", () => {
  it("reports nothing to move and no backup when everything is migrated already", async () => {
    await world.service().migrate();
    await rm(world.backupDirectory, { recursive: true });
    vi.mocked(world.repository.relocate).mockClear();

    const result = await world.service().migrate();

    expect(result).toMatchObject({
      attachmentCount: 2,
      movedCount: 0,
      backupDirectory: null,
    });
    expect(world.repository.relocate).not.toHaveBeenCalled();
  });

  it("removes originals left behind by an interrupted run once they match", async () => {
    await world.service().migrate();
    await mkdir(path.join(world.dataDirectory, "ticket-attachments"), {
      recursive: true,
    });
    await copyFile(
      path.join(world.backupDirectory, "data", "ticket-attachments", PNG_FILE),
      path.join(world.dataDirectory, "ticket-attachments", PNG_FILE),
    );

    const result = await world.service().migrate();

    expect(result).toMatchObject({
      movedCount: 0,
      backupDirectory: world.backupDirectory,
    });
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([]);
    expect(await readFile(path.join(world.dataDirectory, PNG_TARGET))).toEqual(
      PNG_BYTES,
    );
  });

  it("retains a leftover original whose content changed", async () => {
    await world.service().migrate();
    await world.writeData(
      `ticket-attachments/${PNG_FILE}`,
      Buffer.from("changed"),
    );

    await expect(world.service().migrate()).rejects.toThrow(
      `Original changed for ${PNG_ID}; retained.`,
    );

    expect(
      await readFile(
        path.join(world.dataDirectory, "ticket-attachments", PNG_FILE),
      ),
    ).toEqual(Buffer.from("changed"));
  });

  it("skips manifest entries whose attachment no longer exists", async () => {
    await world.service().migrate();
    world.stored = world.stored.filter((row) => row.id !== PNG_ID);
    await rm(path.join(world.dataDirectory, PNG_TARGET));
    await world.writeData(`ticket-attachments/${PNG_FILE}`, PNG_BYTES);

    const result = await world.service().migrate();

    expect(result).toMatchObject({ attachmentCount: 1, movedCount: 0 });
    expect(
      await readFile(
        path.join(world.dataDirectory, "ticket-attachments", PNG_FILE),
      ),
    ).toEqual(PNG_BYTES);
  });
});
