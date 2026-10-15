import { Readable } from "node:stream";

import {
  FileTooLargeError,
  WikiFileStore,
} from "@/backend/storage/WikiFileStore";

import type { ReadStream } from "node:fs";
import type { StoredFile, WriteOptions } from "@/backend/storage/WikiFileStore";

const HEAD_BYTES = 4096;

/**
 * A wiki file store that keeps the bytes in memory.
 *
 * @remarks
 * It follows the contract of the real store: the limit is checked while the
 * bytes stream in, an oversize file leaves nothing behind, and names are picked
 * by the store. No directory of the machine is touched.
 */
export class MemoryWikiFiles extends WikiFileStore {
  /** Stored bytes by storage name. */
  public readonly files = new Map<string, Buffer>();
  /** Every `remove` call, in order. */
  public readonly removals: string[][] = [];
  /** Names `open` was asked for, in order. */
  public readonly opened: string[] = [];
  /** Sizes the write saw before it stopped, per call. */
  public readonly consumed: number[] = [];
  /** Calls of `sweep` with their arguments. */
  public readonly sweeps: { known: string[]; olderThanMilliseconds: number }[] =
    [];
  /** What `sweep` reports as removed. */
  public sweepResult = 0;
  /** Error the next write throws after reading the body; cleared on use. */
  public failNextWrite: Error | null = null;
  private counter = 0;

  public constructor() {
    super("/memory/wiki-files");
  }

  /** Stores the body under a fresh name, or throws `FileTooLargeError`. */
  public override async write(
    source: AsyncIterable<Uint8Array>,
    options: WriteOptions,
  ): Promise<StoredFile> {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > options.absoluteLimit) throw new FileTooLargeError();
        chunks.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      if (size > options.limitFor(content.subarray(0, HEAD_BYTES)))
        throw new FileTooLargeError();
      if (this.failNextWrite !== null) {
        const failure = this.failNextWrite;
        this.failNextWrite = null;
        throw failure;
      }
      this.counter += 1;
      const storageName = `stored-${this.counter}`;
      this.files.set(storageName, content);
      return { checksum: `sum-${size}`, size, storageName };
    } finally {
      this.consumed.push(size);
    }
  }

  /** Streams the stored bytes; an unknown name yields an empty stream. */
  public override open(storageName: string): ReadStream {
    this.opened.push(storageName);
    const stream = Readable.from([
      this.files.get(storageName) ?? Buffer.alloc(0),
    ]);
    // The service only reads and destroys the stream, so a plain readable is enough.
    return stream as ReadStream;
  }

  /** Forgets the named files; unknown names are ignored. */
  public override async remove(storageNames: readonly string[]): Promise<void> {
    this.removals.push([...storageNames]);
    for (const name of storageNames) this.files.delete(name);
  }

  /** Reads the sweep arguments, so a test can prove which names were kept. */
  public override async sweep(
    known: ReadonlySet<string>,
    olderThanMilliseconds: number,
  ): Promise<number> {
    this.sweeps.push({ known: [...known], olderThanMilliseconds });
    return this.sweepResult;
  }
}
