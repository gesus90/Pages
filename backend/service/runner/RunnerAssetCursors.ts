import { createHash } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Hash } from "node:crypto";
import type { Readable } from "node:stream";

/** A file served to a runner as a stream, with the size and digest that were pinned for the step. */
export interface StreamedAsset {
  readonly size: number;
  readonly digest: string;
  /** Opens the original again under the live rights of the person. */
  readonly open: () => Promise<Readable>;
}

/** The bytes a skipped range is read in; they are hashed and dropped. */
const SKIP_BYTES = 1024 * 1024;

/**
 * One sequential read of a file: bytes are taken in order and hashed on the way.
 *
 * @remarks
 * The digest is checked when the last byte was taken, so a file that changed
 * since it was pinned fails the transfer at its end instead of being trusted.
 */
class AssetCursor {
  private readonly iterator: AsyncIterator<unknown>;
  private readonly hash: Hash = createHash("sha256");
  private readonly file: StreamedAsset;
  private leftover: Buffer = Buffer.alloc(0);
  private position = 0;
  private lastOffset = -1;
  private lastChunk: Buffer = Buffer.alloc(0);

  public constructor(stream: Readable, file: StreamedAsset) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.file = file;
  }

  /** Whether the chunk at `offset` lies ahead of the bytes taken so far or repeats the last chunk. */
  public canServe(offset: number): boolean {
    return offset >= this.position || offset === this.lastOffset;
  }

  /**
   * Takes the chunk at `offset`; the chunk before it is served again after a lost answer.
   *
   * @throws {AgentError} `parameter_asset_unavailable` for an offset behind the
   * file or a stream that fails, `parameter_ticket_changed` when the file is
   * not the one that was pinned.
   */
  public async chunk(offset: number, length: number): Promise<Buffer> {
    if (offset === this.lastOffset) return this.lastChunk;
    if (offset < this.position || offset > this.file.size)
      throw new AgentError("parameter_asset_unavailable");
    while (this.position < offset)
      await this.take(Math.min(SKIP_BYTES, offset - this.position));
    const chunk = await this.take(Math.min(length, this.file.size - offset));
    this.lastOffset = offset;
    this.lastChunk = chunk;
    if (this.position === this.file.size) await this.finish();
    return chunk;
  }

  /** Releases the file; the answer of a chunk already taken stays valid. */
  public close(): void {
    this.iterator.return?.().catch((error: unknown) => {
      logCaughtError("RunnerAssetCursors", error);
    });
  }

  private async take(length: number): Promise<Buffer> {
    const parts = [this.leftover];
    let have = this.leftover.length;
    while (have < length) {
      const next = await this.next();
      if (next === null) throw new AgentError("parameter_ticket_changed");
      parts.push(next);
      have += next.length;
    }
    const all = Buffer.concat(parts, have);
    const taken = all.subarray(0, length);
    this.leftover = all.subarray(length);
    this.hash.update(taken);
    this.position += taken.length;
    return taken;
  }

  private async finish(): Promise<void> {
    if (this.leftover.length > 0 || (await this.next()) !== null)
      throw new AgentError("parameter_ticket_changed");
    if (this.hash.digest("hex") !== this.file.digest)
      throw new AgentError("parameter_ticket_changed");
  }

  private async next(): Promise<Buffer | null> {
    try {
      const step = await this.iterator.next();
      if (step.done === true) return null;
      if (!Buffer.isBuffer(step.value)) throw new TypeError("Unexpected chunk");
      return step.value;
    } catch (error: unknown) {
      logCaughtError("RunnerAssetCursors", error);
      throw new AgentError("parameter_asset_unavailable");
    }
  }
}

/**
 * The files of one step that are served in chunks without being held in memory.
 *
 * @remarks
 * A runner reads a file front to back, so one open cursor serves all its
 * chunks and the cost of a file is one read instead of one read per chunk. Only
 * one cursor is open at a time; asking for another file, or for a position the
 * cursor passed, starts a new one and costs one more read, never a wrong byte.
 */
export class RunnerAssetCursors {
  private current: {
    readonly index: number;
    readonly cursor: AssetCursor;
  } | null = null;

  /**
   * Reads the next bytes of one file.
   *
   * @param index - The position of the file in the step's manifest.
   * @param offset - Where the chunk starts.
   * @param length - How many bytes the chunk may have.
   * @param file - The pinned file.
   * @returns At most `length` bytes; fewer only at the end of the file.
   */
  public async read(
    index: number,
    offset: number,
    length: number,
    file: StreamedAsset,
  ): Promise<Buffer> {
    let cursor =
      this.current?.index === index && this.current.cursor.canServe(offset)
        ? this.current.cursor
        : null;
    if (cursor === null) {
      this.close();
      cursor = new AssetCursor(await file.open(), file);
      this.current = { index, cursor };
    }
    try {
      return await cursor.chunk(offset, length);
    } catch (error: unknown) {
      this.close();
      throw error;
    }
  }

  /** Releases the open file at the end of the step. */
  public close(): void {
    this.current?.cursor.close();
    this.current = null;
  }
}
