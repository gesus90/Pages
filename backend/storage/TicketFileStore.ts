import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { WikiFileStore } from "./WikiFileStore";
import { detectTicketFileType } from "./TicketFileType";

import type { ReadStream } from "node:fs";
import type { StoredFile, WriteOptions } from "./WikiFileStore";
import type { TicketFileType } from "./TicketFileType";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEGACY_NAME = new RegExp(`^${UUID}$`, "i");
const ASSET_PATH = new RegExp(`^assets/${UUID}/${UUID}\\.[a-z0-9]+$`, "i");

/** Facts verified by reading a stored file, also used by migration and inventory. */
export interface InspectedTicketFile extends Omit<StoredFile, "storageName"> {
  readonly type: TicketFileType;
}

/** Validates server-owned relative paths before touching the data directory. */
export function isTicketAssetPath(storageName: string): boolean {
  return ASSET_PATH.test(storageName);
}

/** Keeps each ticket's files beneath its immutable UUID in the Pages data directory. */
export class TicketFileStore {
  private readonly directory: string;

  public constructor(directory: string) {
    this.directory = directory;
  }

  /** Streams directly into the ticket directory and publishes the content-derived filename. */
  public async write(
    destination: { readonly ticketId: string; readonly attachmentId: string },
    source: AsyncIterable<Uint8Array>,
    options: WriteOptions,
  ): Promise<StoredFile & { readonly type: TicketFileType }> {
    if (
      !LEGACY_NAME.test(destination.ticketId) ||
      !LEGACY_NAME.test(destination.attachmentId)
    )
      throw new Error("Invalid ticket attachment identifier.");
    const relativeDirectory = `assets/${destination.ticketId}`;
    const ticketDirectory = path.join(this.directory, relativeDirectory);
    await mkdir(ticketDirectory, { recursive: true });
    if (
      !(await lstat(path.join(this.directory, "assets"))).isDirectory() ||
      !(await lstat(ticketDirectory)).isDirectory()
    )
      throw new Error("Invalid ticket attachment directory.");
    const store = new WikiFileStore(ticketDirectory);
    let type = detectTicketFileType(Buffer.alloc(0));
    const stored = await store.write(source, {
      absoluteLimit: options.absoluteLimit,
      limitFor: (head) => {
        type = detectTicketFileType(head);
        return options.limitFor(head);
      },
    });
    const storageName = `${relativeDirectory}/${destination.attachmentId}.${type.extension}`;
    try {
      await rename(
        path.join(ticketDirectory, stored.storageName),
        this.resolve(storageName),
      );
      return { ...stored, storageName, type };
    } catch (error: unknown) {
      await store.remove([stored.storageName]);
      throw error;
    }
  }

  /** Opens only a validated relative path; legacy reads remain available until the offline migration. */
  public open(storageName: string): ReadStream {
    return createReadStream(this.resolve(storageName));
  }

  /** Rejects missing files and symbolic links before a response is started. */
  public async requireFile(storageName: string): Promise<void> {
    const file = this.resolve(storageName);
    const parent = await lstat(path.dirname(file));
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error("Invalid ticket attachment directory.");
    if (!(await lstat(file)).isFile())
      throw new Error("Invalid ticket attachment file.");
  }

  /** Recomputes size, checksum and content type without trusting the original filename. */
  public async inspect(storageName: string): Promise<InspectedTicketFile> {
    await this.requireFile(storageName);
    const hash = createHash("sha256");
    let size = 0;
    let head = Buffer.alloc(0);
    for await (const chunk of this.open(storageName)) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Invalid file stream.");
      size += chunk.length;
      hash.update(chunk);
      if (head.length < 4096)
        head = Buffer.concat([head, chunk]).subarray(0, 4096);
    }
    return {
      size,
      checksum: hash.digest("hex"),
      type: detectTicketFileType(head),
    };
  }

  /** Deletes bytes and removes empty ticket folders, including after permanent ticket deletion. */
  public async remove(storageNames: readonly string[]): Promise<void> {
    for (const storageName of storageNames) {
      await rm(this.resolve(storageName), { force: true });
      if (isTicketAssetPath(storageName))
        await this.removeEmptyDirectory(
          path.dirname(this.resolve(storageName)),
        );
    }
  }

  /** Sweeps interrupted new uploads; legacy inconsistencies are left to the read-only inventory. */
  public async sweep(
    known: ReadonlySet<string>,
    olderThanMilliseconds: number,
  ): Promise<number> {
    const root = path.join(this.directory, "assets");
    const tickets = await readdir(root, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    let removed = 0;
    for (const ticket of tickets) {
      if (!ticket.isDirectory() || !LEGACY_NAME.test(ticket.name)) continue;
      removed += await this.sweepTicket(
        ticket.name,
        known,
        olderThanMilliseconds,
      );
      await this.removeEmptyDirectory(path.join(root, ticket.name));
    }
    return removed;
  }

  private resolve(storageName: string): string {
    if (isTicketAssetPath(storageName))
      return path.join(this.directory, storageName);
    if (LEGACY_NAME.test(storageName))
      return path.join(this.directory, "ticket-attachments", storageName);
    throw new Error("Invalid ticket attachment storage path.");
  }

  private async sweepTicket(
    ticketId: string,
    known: ReadonlySet<string>,
    age: number,
  ): Promise<number> {
    const directory = path.join(this.directory, "assets", ticketId);
    let removed = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `assets/${ticketId}/${entry.name}`;
      if (!entry.isFile() || known.has(relative)) continue;
      const file = path.join(directory, entry.name);
      if ((await lstat(file)).mtimeMs >= Date.now() - age) continue;
      await rm(file);
      removed += 1;
    }
    return removed;
  }

  private async removeEmptyDirectory(directory: string): Promise<void> {
    try {
      await rmdir(directory);
    } catch (error: unknown) {
      if (
        !isMissing(error) &&
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOTEMPTY"
        )
      )
        throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
