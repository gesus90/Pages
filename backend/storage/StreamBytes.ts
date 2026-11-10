import { StreamTooLargeError } from "./StreamDigest";

import type { Readable } from "node:stream";

/**
 * Collects a short stream completely.
 *
 * @param stream - The bytes to collect; destroyed when this returns or fails.
 * @param maximumBytes - The most the stream may deliver.
 * @returns All bytes of the stream.
 * @throws {StreamTooLargeError} When the stream is longer than `maximumBytes`.
 */
export async function collectStream(
  stream: Readable,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new TypeError("Unexpected chunk");
      size += chunk.length;
      if (size > maximumBytes) throw new StreamTooLargeError();
      chunks.push(chunk);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks, size);
}
