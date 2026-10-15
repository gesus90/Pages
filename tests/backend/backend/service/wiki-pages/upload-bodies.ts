/** The first bytes of a PNG file. */
export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Streams the given parts, one chunk each, the way a request body arrives.
 *
 * @param parts - The chunks of the body.
 * @returns A body that yields each part once.
 */
export async function* bodyOf(
  ...parts: readonly Uint8Array[]
): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part;
  }
}

/**
 * Builds a PNG-looking body of the given size in several chunks.
 *
 * @param size - Total number of bytes, at least the signature length.
 * @returns A body whose head is a PNG signature.
 */
export function pngBody(size: number): AsyncGenerator<Uint8Array> {
  const rest = Buffer.alloc(size - PNG_SIGNATURE.length, 1);
  const half = Math.floor(rest.length / 2);
  return bodyOf(PNG_SIGNATURE, rest.subarray(0, half), rest.subarray(half));
}

/**
 * Builds a body of bytes no format recognizes.
 *
 * @param size - Total number of bytes.
 * @returns A body of that many `0x41` bytes.
 */
export function plainBody(size: number): AsyncGenerator<Uint8Array> {
  return bodyOf(Buffer.alloc(size, 0x41));
}
