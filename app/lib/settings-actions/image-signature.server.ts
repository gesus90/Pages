const MINIMUM_IMAGE_BYTES = 12;

/**
 * Checks that an image begins with the magic bytes of its MIME type.
 *
 * @param buffer - The uploaded file.
 * @param mimeType - The type the browser announced.
 * @returns Whether the content looks like a JPEG, PNG, or WebP image of that type.
 */
export function hasImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < MINIMUM_IMAGE_BYTES) {
    return false;
  }

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  return (
    mimeType === "image/webp" &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}
