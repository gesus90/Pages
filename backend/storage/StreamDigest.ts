import { createHash } from "node:crypto";

import type { Readable } from "node:stream";

/** Thrown when a stream delivers more bytes than the caller allows. */
export class StreamTooLargeError extends Error {
  public constructor() {
    super("The stream exceeds the size limit.");
    this.name = "StreamTooLargeError";
  }
}

/** Bytes of the start of a stream that are kept for the detection of its type. */
const HEAD_BYTES = 4096;

/** Length, hex SHA-256 and first bytes of a stream that was read to its end. */
export interface StreamDigest {
  readonly size: number;
  readonly digest: string;
  readonly head: Buffer;
}

/**
 * Reads a stream to its end and returns its length and SHA-256.
 *
 * @param stream - The bytes to measure; destroyed when this returns or fails.
 * @param maximumBytes - The most the stream may deliver.
 * @returns What the stream delivered; only its first 4 KiB are kept in memory.
 * @throws {StreamTooLargeError} When the stream is longer than `maximumBytes`.
 */
export async function digestStream(
  stream: Readable,
  maximumBytes: number,
): Promise<StreamDigest> {
  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new TypeError("Unexpected chunk");
      size += chunk.length;
      if (size > maximumBytes) throw new StreamTooLargeError();
      if (head.length < HEAD_BYTES)
        head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return { size, digest: hash.digest("hex"), head };
}
