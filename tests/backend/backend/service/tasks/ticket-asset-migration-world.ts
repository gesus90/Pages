import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, vi } from "vitest";

import { TicketAssetMigrationRepository } from "@/backend/database/repositories/task/TicketAssetMigrationRepository";
import { TicketAssetMigrationService } from "@/backend/service/task/TicketAssetMigrationService";

import { bareInstance } from "./bare-instance";

import type * as FileSystem from "node:fs/promises";
import type { StoredWorkItemAttachment } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import type { TicketAssetMigrationEntry } from "@/backend/service/task/TicketAssetMigrationService";

export const TICKET = "11111111-1111-4111-8111-111111111111";
export const PNG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PDF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PNG_FILE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PDF_FILE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic picture"),
]);
export const PDF_BYTES = Buffer.from("%PDF-1.4 synthetic document");
export const PNG_TARGET = `assets/${TICKET}/${PNG_ID}.png`;
export const PDF_TARGET = `assets/${TICKET}/${PDF_ID}.pdf`;

const MANIFEST_NAME = "ticket-assets-manifest.json";

/** The manifest as stored in the backup, with entries that tests may corrupt. */
export interface StoredManifest {
  directory: string;
  entries: Record<string, unknown>[];
}

/** Hex SHA-256 of synthetic file content. */
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A stored legacy attachment record for synthetic content. */
export function attachment(
  id: string,
  storageName: string,
  bytes: Buffer,
): StoredWorkItemAttachment {
  return {
    id,
    workItemId: TICKET,
    fileName: "original.bin",
    contentType: "application/octet-stream",
    kind: "file",
    size: bytes.length,
    checksum: sha256(bytes),
    storageName,
    uploadedBy: "user-1",
    uploadedByName: "Ada",
    createdAt: "2026-01-01 00:00:00",
  };
}

/** One temporary data directory with its attachment records and a stand-in repository. */
class MigrationWorld {
  public scratch = "";
  public dataDirectory = "";
  public backupDirectory = "";
  public stored: StoredWorkItemAttachment[] = [];
  public repository = bareInstance(TicketAssetMigrationRepository.prototype);
  public backupDatabase = vi.fn(async (directory: string): Promise<void> => {
    await writeFile(path.join(directory, "database.dump"), "dump");
  });

  /** Creates the directory with two legacy files and their records. */
  public async open(): Promise<void> {
    const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
    vi.mocked(lstat).mockImplementation(actual.lstat);
    vi.mocked(cp).mockImplementation(actual.cp);
    vi.mocked(copyFile).mockImplementation(actual.copyFile);
    this.scratch = await mkdtemp(path.join(tmpdir(), "pages-asset-migration-"));
    this.dataDirectory = path.join(this.scratch, "data");
    this.backupDirectory = path.join(this.scratch, "backup");
    await mkdir(this.dataDirectory);
    await this.writeData(`ticket-attachments/${PNG_FILE}`, PNG_BYTES);
    await this.writeData(`ticket-attachments/${PDF_FILE}`, PDF_BYTES);
    this.stored = [
      attachment(PNG_ID, PNG_FILE, PNG_BYTES),
      attachment(PDF_ID, PDF_FILE, PDF_BYTES),
    ];
    this.backupDatabase = vi.fn(async (directory: string): Promise<void> => {
      await writeFile(path.join(directory, "database.dump"), "dump");
    });
    this.installRepository();
  }

  /** Removes the temporary directory. */
  public async close(): Promise<void> {
    await rm(this.scratch, { recursive: true, force: true });
  }

  /** Writes a file beneath the data directory. */
  public async writeData(relative: string, bytes: Buffer): Promise<void> {
    const target = path.join(this.dataDirectory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  /** The service under test, wired to this directory and repository. */
  public service(): TicketAssetMigrationService {
    return new TicketAssetMigrationService(
      this.repository,
      this.dataDirectory,
      this.backupDirectory,
      this.backupDatabase,
    );
  }

  /** The manifest written into the backup. */
  public async manifestFile(): Promise<StoredManifest> {
    return JSON.parse(
      await readFile(path.join(this.backupDirectory, MANIFEST_NAME), "utf8"),
    );
  }

  /** Rewrites the stored manifest with the changed content. */
  public async replaceManifest(
    change: (manifest: StoredManifest) => unknown,
  ): Promise<void> {
    const manifest = await this.manifestFile();
    await writeFile(
      path.join(this.backupDirectory, MANIFEST_NAME),
      JSON.stringify(change(manifest)),
    );
  }

  /** Creates the backup folder holding a manifest with the given content. */
  public async backupWithManifest(content: unknown): Promise<void> {
    await mkdir(this.backupDirectory);
    await writeFile(
      path.join(this.backupDirectory, MANIFEST_NAME),
      JSON.stringify(content),
    );
  }

  /** The manifest entry of the picture after a completed migration. */
  public validEntry(): TicketAssetMigrationEntry {
    return {
      id: PNG_ID,
      oldStorageName: PNG_FILE,
      storageName: PNG_TARGET,
      checksum: sha256(PNG_BYTES),
      size: PNG_BYTES.length,
      contentType: "image/png",
      kind: "media",
    };
  }

  /** Sorted names in a directory, empty when it does not exist. */
  public async names(directory: string): Promise<string[]> {
    return (await readdir(directory).catch(() => [])).sort();
  }

  private installRepository(): void {
    this.repository = bareInstance(TicketAssetMigrationRepository.prototype);
    vi.spyOn(this.repository, "attachments").mockImplementation(async () =>
      this.stored.map((row) => ({ ...row })),
    );
    vi.spyOn(this.repository, "checkpoint").mockResolvedValue();
    vi.spyOn(this.repository, "relocate").mockImplementation(async (rows) => {
      this.stored = this.stored.map((row) => {
        const moved = rows.find((candidate) => candidate.id === row.id);
        return moved ? { ...row, ...moved } : row;
      });
    });
  }
}

/** The world of the running test; recreated before each test. */
export const world = new MigrationWorld();

/** Registers the per-test setup; the test file mocks `node:fs/promises` itself. */
export function useMigrationWorld(): void {
  beforeEach(async () => {
    await world.open();
  });
  afterEach(async () => {
    await world.close();
  });
}
