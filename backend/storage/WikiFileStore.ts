import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ReadStream } from "node:fs";

/** Bytes of the start of a file that the type detection looks at. */
const HEAD_BYTES = 4096;

/** A file that was written to the store. */
export interface StoredFile {
  /** Name the server picked; the only handle to the file. */
  readonly storageName: string;
  readonly size: number;
  /** Hex SHA-256 of the content. */
  readonly checksum: string;
}

/** Thrown while writing when a file grows beyond the limit set for it. */
export class FileTooLargeError extends Error {
  public constructor() {
    super("The file exceeds the size limit.");
    this.name = "FileTooLargeError";
  }
}

/** Options of {@link WikiFileStore.write}. */
export interface WriteOptions {
  /**
   * Called once with the start of the file, to say how large it may be.
   *
   * @returns The limit in bytes for this file.
   */
  readonly limitFor: (head: Buffer) => number;
  /** Limit that holds until the start of the file is known. */
  readonly absoluteLimit: number;
}

/**
 * Keeps wiki attachments as files in one directory.
 *
 * @remarks
 * Names are picked by the server and never come from a user, so a path
 * cannot be steered outside the directory.
 */
export class WikiFileStore {
  private readonly directory: string;

  /**
   * Creates a file store.
   *
   * @param directory - Directory that holds the files; created when needed.
   */
  public constructor(directory: string) {
    this.directory = directory;
  }

  /**
   * Streams a file to the disk while counting, hashing and limiting it.
   *
   * @param source - The bytes of the file.
   * @param options - The size limit rules.
   * @returns Where the file lies and what it is.
   * @throws {FileTooLargeError} When the file outgrows its limit; nothing
   * remains on the disk then.
   */
  public async write(
    source: AsyncIterable<Uint8Array>,
    options: WriteOptions,
  ): Promise<StoredFile> {
    await mkdir(this.directory, { recursive: true });

    const storageName = randomUUID();
    const partial = path.join(this.directory, `${storageName}.part`);
    const hash = createHash("sha256");
    let size = 0;
    let limit = options.absoluteLimit;
    let head = Buffer.alloc(0);
    let isHeadKnown = false;

    async function* guarded(): AsyncGenerator<Uint8Array> {
      for await (const chunk of source) {
        size += chunk.length;

        if (!isHeadKnown) {
          head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
          isHeadKnown = head.length >= HEAD_BYTES;
          limit = isHeadKnown ? options.limitFor(head) : limit;
        }

        if (size > limit) {
          throw new FileTooLargeError();
        }

        hash.update(chunk);
        yield chunk;
      }

      if (!isHeadKnown) {
        limit = options.limitFor(head);

        if (size > limit) {
          throw new FileTooLargeError();
        }
      }
    }

    try {
      await pipeline(Readable.from(guarded()), createWriteStream(partial));
      await rename(partial, path.join(this.directory, storageName));
    } catch (error: unknown) {
      await rm(partial, { force: true });

      throw error;
    }

    return { checksum: hash.digest("hex"), size, storageName };
  }

  /**
   * Opens a stored file for reading.
   *
   * @param storageName - Name the store gave the file.
   * @returns A read stream.
   */
  public open(storageName: string): ReadStream {
    return createReadStream(
      path.join(this.directory, path.basename(storageName)),
    );
  }

  /**
   * Removes files; names that do not exist are ignored.
   *
   * @param storageNames - Names the store gave the files.
   */
  public async remove(storageNames: readonly string[]): Promise<void> {
    for (const name of storageNames) {
      await rm(path.join(this.directory, path.basename(name)), { force: true });
    }
  }

  /**
   * Removes files nobody refers to any more.
   *
   * @param known - Names the database still lists.
   * @param olderThanMilliseconds - Files younger than this stay, so uploads
   * that are still running are never touched.
   * @returns How many files were removed.
   */
  public async sweep(
    known: ReadonlySet<string>,
    olderThanMilliseconds: number,
  ): Promise<number> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const cutoff = Date.now() - olderThanMilliseconds;
    let removed = 0;

    for (const name of names) {
      const file = path.join(this.directory, name);

      if (!known.has(name) && (await stat(file)).mtimeMs < cutoff) {
        await rm(file, { force: true });
        removed += 1;
      }
    }

    return removed;
  }
}
