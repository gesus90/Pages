import { copyFile, cp, lstat, readFile, rm, writeFile } from "node:fs/promises";
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

describe("migrate backup and legacy store failures", () => {
  it("aborts before moving anything when the backup copy is damaged", async () => {
    const actualCopy =
      await vi.importActual<typeof FileSystem>("node:fs/promises");
    vi.mocked(cp).mockImplementationOnce(async (source, target, options) => {
      await actualCopy.cp(source, target, options);
      await writeFile(
        path.join(String(target), "ticket-attachments", PNG_FILE),
        "damaged",
      );
    });

    await expect(world.service().migrate()).rejects.toThrow(
      `Backup verification failed for ${PNG_ID}. No originals moved.`,
    );

    expect(world.repository.relocate).not.toHaveBeenCalled();
    expect(await world.names(world.backupDirectory)).not.toContain(
      "ticket-assets-manifest.json",
    );
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([PNG_FILE, PDF_FILE].sort());
  });

  it("rethrows a failure to read the legacy folder other than a missing one", async () => {
    await world.service().migrate();
    await rm(path.join(world.dataDirectory, "ticket-attachments"), {
      recursive: true,
    });
    await writeFile(
      path.join(world.dataDirectory, "ticket-attachments"),
      "file",
    );

    await expect(world.service().migrate()).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("rethrows a failure to look up a leftover original", async () => {
    await world.service().migrate();
    const actualLstat =
      await vi.importActual<typeof FileSystem>("node:fs/promises");
    vi.mocked(lstat).mockImplementation(async (target, options) => {
      if (String(target).endsWith(`ticket-attachments/${PNG_FILE}`))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return actualLstat.lstat(target, options);
    });

    await expect(world.service().migrate()).rejects.toThrow("denied");
  });
});

describe("migrate resume", () => {
  it("resumes after an interruption with the same backup and reuses verified copies", async () => {
    vi.mocked(world.repository.relocate).mockRejectedValueOnce(
      new Error("connection lost"),
    );
    await expect(world.service().migrate()).rejects.toThrow("connection lost");
    expect(world.stored.map((row) => row.storageName)).toEqual([
      PNG_FILE,
      PDF_FILE,
    ]);
    expect(await readFile(path.join(world.dataDirectory, PNG_TARGET))).toEqual(
      PNG_BYTES,
    );

    const result = await world.service().migrate();

    expect(result.movedCount).toBe(2);
    expect(world.backupDatabase).toHaveBeenCalledTimes(1);
    expect(world.stored.map((row) => row.storageName)).toEqual([
      PNG_TARGET,
      PDF_TARGET,
    ]);
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([]);
  });

  it("refuses to resume when the attachment count changed since the backup", async () => {
    vi.mocked(world.repository.relocate).mockRejectedValueOnce(
      new Error("stop"),
    );
    await expect(world.service().migrate()).rejects.toThrow("stop");
    const extra = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await world.writeData(`ticket-attachments/${extra}`, PDF_BYTES);
    world.stored = [...world.stored, attachment(extra, extra, PDF_BYTES)];

    await expect(world.service().migrate()).rejects.toThrow(
      "Attachment count changed since backup; migration aborted.",
    );
  });

  it("refuses to resume when an attachment differs from the manifest", async () => {
    vi.mocked(world.repository.relocate).mockRejectedValueOnce(
      new Error("stop"),
    );
    await expect(world.service().migrate()).rejects.toThrow("stop");
    await world.replaceManifest((manifest) => ({
      ...manifest,
      entries: manifest.entries.map((entry) =>
        entry.id === PDF_ID ? { ...entry, size: 1 } : entry,
      ),
    }));

    await expect(world.service().migrate()).rejects.toThrow(
      `Attachment ${PDF_ID}: differs from backup manifest; migration aborted.`,
    );
  });

  it("refuses to resume when an attachment is missing from the manifest", async () => {
    vi.mocked(world.repository.relocate).mockRejectedValueOnce(
      new Error("stop"),
    );
    await expect(world.service().migrate()).rejects.toThrow("stop");
    await world.replaceManifest((manifest) => ({
      ...manifest,
      entries: manifest.entries.map((entry) =>
        entry.id === PDF_ID ? { ...entry, id: PNG_FILE } : entry,
      ),
    }));

    await expect(world.service().migrate()).rejects.toThrow(
      `Attachment ${PDF_ID}: differs from backup manifest; migration aborted.`,
    );
  });
});

describe("migrate verification", () => {
  it("retains the originals when a reused destination does not match", async () => {
    await world.writeData(PNG_TARGET, Buffer.from("tampered"));

    await expect(world.service().migrate()).rejects.toThrow(
      `Destination mismatch for ${PNG_ID}; originals retained.`,
    );

    expect(world.repository.relocate).not.toHaveBeenCalled();
    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([PNG_FILE, PDF_FILE].sort());
  });

  it("rethrows a copy failure other than an existing destination", async () => {
    vi.mocked(copyFile).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );

    await expect(world.service().migrate()).rejects.toThrow("denied");

    expect(world.repository.relocate).not.toHaveBeenCalled();
  });

  it("rethrows a copy failure that carries no error code", async () => {
    vi.mocked(copyFile).mockRejectedValueOnce(new Error("no code"));

    await expect(world.service().migrate()).rejects.toThrow("no code");
  });

  it("retains the originals when the metadata did not switch", async () => {
    vi.mocked(world.repository.relocate).mockResolvedValue();

    await expect(world.service().migrate()).rejects.toThrow(
      `Metadata mismatch for ${PNG_ID}; originals retained.`,
    );

    expect(
      await world.names(path.join(world.dataDirectory, "ticket-attachments")),
    ).toEqual([PNG_FILE, PDF_FILE].sort());
  });

  it("retains the originals when an attachment appeared during the switch", async () => {
    vi.mocked(world.repository.relocate).mockImplementation(async () => {
      world.stored = [
        ...world.stored,
        attachment(
          "99999999-9999-4999-8999-999999999999",
          PNG_TARGET,
          PNG_BYTES,
        ),
      ];
    });

    await expect(world.service().migrate()).rejects.toThrow(
      "Attachment count changed; originals retained.",
    );
  });

  it("retains the originals when the metadata names an unknown attachment", async () => {
    vi.mocked(world.repository.relocate).mockImplementation(async () => {
      world.stored = world.stored.map((row, index) =>
        index === 0
          ? { ...row, id: "99999999-9999-4999-8999-999999999999" }
          : row,
      );
    });

    await expect(world.service().migrate()).rejects.toThrow(
      "Metadata mismatch for 99999999-9999-4999-8999-999999999999; originals retained.",
    );
  });
});
