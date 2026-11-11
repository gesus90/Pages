import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { TicketAssetMigrationService } from "@/backend/service/task/TicketAssetMigrationService";

import {
  PDF_BYTES,
  PDF_FILE,
  PDF_ID,
  PDF_TARGET,
  PNG_BYTES,
  PNG_FILE,
  PNG_ID,
  PNG_TARGET,
  TICKET,
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

describe("construction", () => {
  it.each([
    {
      description: "the data directory itself",
      location: () => world.dataDirectory,
    },
    {
      description: "a folder inside the data directory",
      location: () => `${world.dataDirectory}/backup`,
    },
  ])("refuses a backup in $description", ({ location }) => {
    expect(
      () =>
        new TicketAssetMigrationService(
          world.repository,
          world.dataDirectory,
          location(),
          world.backupDatabase,
        ),
    ).toThrow("The backup must be outside the Pages data directory.");
  });

  it("accepts a sibling whose name merely starts like the data directory", () => {
    expect(
      () =>
        new TicketAssetMigrationService(
          world.repository,
          world.dataDirectory,
          `${world.dataDirectory}-backup`,
          world.backupDatabase,
        ),
    ).not.toThrow();
  });
});

describe("inspect", () => {
  it("plans the move of each legacy file from its bytes without writing", async () => {
    const entries = await world.service().inspect();

    expect(entries).toEqual([
      {
        id: PNG_ID,
        oldStorageName: PNG_FILE,
        storageName: PNG_TARGET,
        checksum: sha256(PNG_BYTES),
        size: PNG_BYTES.length,
        contentType: "image/png",
        kind: "media",
      },
      {
        id: PDF_ID,
        oldStorageName: PDF_FILE,
        storageName: PDF_TARGET,
        checksum: sha256(PDF_BYTES),
        size: PDF_BYTES.length,
        contentType: "application/pdf",
        kind: "file",
      },
    ]);
    expect(await world.names(world.scratch)).toEqual(["data"]);
    expect(world.repository.relocate).not.toHaveBeenCalled();
  });

  it("refuses a changed checksum", async () => {
    const [png] = world.stored;
    world.stored = [
      { ...attachment(PNG_ID, PNG_FILE, PNG_BYTES), checksum: "0" },
    ];
    expect(png).toBeDefined();

    await expect(world.service().inspect()).rejects.toThrow(
      `Attachment ${PNG_ID}: size or checksum mismatch; migration aborted.`,
    );
  });

  it("refuses a changed size", async () => {
    world.stored = [{ ...attachment(PNG_ID, PNG_FILE, PNG_BYTES), size: 1 }];

    await expect(world.service().inspect()).rejects.toThrow(
      `Attachment ${PNG_ID}: size or checksum mismatch; migration aborted.`,
    );
  });

  it("refuses a ticket identifier that is no UUID", async () => {
    world.stored = [
      { ...attachment(PNG_ID, PNG_FILE, PNG_BYTES), workItemId: "../escape" },
    ];

    await expect(world.service().inspect()).rejects.toThrow(
      `Attachment ${PNG_ID}: invalid identifier.`,
    );
  });

  it("refuses an asset path that is not the expected destination", async () => {
    const wrong = `assets/${TICKET}/${PDF_ID}.png`;
    await world.writeData(wrong, PNG_BYTES);
    world.stored = [attachment(PNG_ID, wrong, PNG_BYTES)];

    await expect(world.service().inspect()).rejects.toThrow(
      `Attachment ${PNG_ID}: unexpected destination path.`,
    );
  });
});

describe("inspect of an inconsistent store", () => {
  it("refuses legacy files and folders without an attachment record", async () => {
    await world.writeData(
      "ticket-attachments/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      PNG_BYTES,
    );
    await mkdir(path.join(world.dataDirectory, "ticket-attachments", "nested"));

    await expect(world.service().inspect()).rejects.toThrow(
      "Files without attachment records (not deleted): eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee, nested",
    );
  });

  it("works without a legacy folder when every file is already migrated", async () => {
    await rm(path.join(world.dataDirectory, "ticket-attachments"), {
      recursive: true,
    });
    await world.writeData(PNG_TARGET, PNG_BYTES);
    world.stored = [attachment(PNG_ID, PNG_TARGET, PNG_BYTES)];

    const entries = await world.service().inspect();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.oldStorageName).toBe(PNG_TARGET);
    expect(entries[0]?.storageName).toBe(PNG_TARGET);
  });

  it("refuses unrecorded files in the asset store", async () => {
    await world.writeData("assets/stray.txt", Buffer.from("stray"));
    await world.writeData(`assets/${TICKET}/unrecorded.png`, PNG_BYTES);
    await mkdir(path.join(world.dataDirectory, "assets", "folder", "inner"), {
      recursive: true,
    });

    await expect(world.service().inspect()).rejects.toThrow(
      `Files without attachment records (not deleted): assets/${TICKET}/unrecorded.png, assets/folder/inner, assets/stray.txt`,
    );
  });

  it("rethrows a read failure that is not a missing folder", async () => {
    await rm(path.join(world.dataDirectory, "assets"), {
      recursive: true,
    }).catch(() => undefined);
    await writeFile(path.join(world.dataDirectory, "assets"), "not a folder");

    await expect(world.service().inspect()).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});
