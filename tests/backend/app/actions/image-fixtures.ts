/** First bytes of a JPEG file, padded to a plausible length. */
export function jpegBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);

  bytes.set([0xff, 0xd8, 0xff, 0xe0]);

  return bytes;
}

/** First bytes of a PNG file, padded to a plausible length. */
export function pngBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return bytes;
}

/** A RIFF container that announces WebP content. */
export function webpBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);

  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);

  return bytes;
}

/** Wraps bytes in an uploaded file the way a browser form submits it. */
export function uploadedFile(
  bytes: Uint8Array,
  name: string,
  type: string,
): File {
  return new File([Uint8Array.from(bytes)], name, { type });
}
