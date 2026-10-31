import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_MAXIMUM_AVATAR_BYTES } from "@/definition/PicaMobileProtocol";

import type * as CanvasLibrary from "@napi-rs/canvas";
import type { Image } from "@napi-rs/canvas";

/** An avatar image that fits the size limit of the `avatar` message. */
export interface ShrunkAvatarImage {
  readonly mimeType: string;
  readonly data: Buffer;
}

interface ImageSize {
  readonly width: number;
  readonly height: number;
}

type CanvasModule = typeof CanvasLibrary;

const COMPONENT = "PicaMobileAvatarImage";
// Decoding needs four bytes per pixel; a header that claims more is refused
// before any memory is spent on it.
const MAXIMUM_SOURCE_PIXELS = 25_000_000;
const LONGEST_EDGE_STEPS: readonly number[] = [256, 192, 128, 96, 64];
const LOSSY_QUALITY_STEPS: readonly number[] = [80, 65, 50, 35];
const JPEG_START_OF_SCAN = 0xda;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_FRAME_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

// The native image library loads on first use, so a platform without it
// costs the avatars only and never the start of the server.
function loadCanvasModule(): Promise<CanvasModule> {
  return import("@napi-rs/canvas");
}

function readPngSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24 || !bytes.subarray(0, 4).equals(PNG_SIGNATURE)) {
    return null;
  }

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegSize(bytes: Buffer): ImageSize | null {
  let offset = 2;

  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }

    const marker = bytes[offset + 1] ?? 0;

    if (JPEG_FRAME_MARKERS.has(marker)) {
      return {
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5),
      };
    }

    // The scan data begins: no frame header came before it.
    if (marker === JPEG_START_OF_SCAN) {
      return null;
    }

    offset += marker === 0xff ? 1 : 2 + bytes.readUInt16BE(offset + 2);
  }

  return null;
}

function readWebpSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 30 || bytes.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const chunk = bytes.toString("ascii", 12, 16);

  if (chunk === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }

  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);

    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  return chunk === "VP8 "
    ? {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      }
    : null;
}

function readImageSize(bytes: Buffer, mimeType: string): ImageSize | null {
  if (mimeType === "image/png") {
    return readPngSize(bytes);
  }

  if (mimeType === "image/jpeg") {
    return readJpegSize(bytes);
  }

  return mimeType === "image/webp" ? readWebpSize(bytes) : null;
}

function scaledSize(source: ImageSize, longestEdge: number): ImageSize {
  const scale = Math.min(1, longestEdge / Math.max(source.width, source.height));

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

function encodeScaled(
  canvasModule: CanvasModule,
  image: Image,
  longestEdge: number,
  mimeType: string,
): Buffer | null {
  const size = scaledSize(image, longestEdge);
  const canvas = canvasModule.createCanvas(size.width, size.height);

  canvas.getContext("2d").drawImage(image, 0, 0, size.width, size.height);

  if (mimeType === "image/png") {
    const encoded = canvas.toBuffer("image/png");

    return encoded.length <= PICA_MOBILE_MAXIMUM_AVATAR_BYTES ? encoded : null;
  }

  for (const quality of LOSSY_QUALITY_STEPS) {
    const encoded =
      mimeType === "image/jpeg"
        ? canvas.toBuffer("image/jpeg", quality)
        : canvas.toBuffer("image/webp", quality);

    if (encoded.length <= PICA_MOBILE_MAXIMUM_AVATAR_BYTES) {
      return encoded;
    }
  }

  return null;
}

async function decode(
  canvasModule: CanvasModule,
  bytes: Buffer,
): Promise<Image | null> {
  try {
    return await canvasModule.loadImage(bytes);
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);

    return null;
  }
}

/**
 * Shrinks a stored avatar image until it fits the size limit of the protocol.
 *
 * @param bytes - The stored image bytes.
 * @param mimeType - The stored image type: JPEG, PNG or WebP.
 * @returns The re-encoded image of the same type, or `null` when the image is
 * damaged, claims more pixels than Pages decodes, or cannot be made small enough.
 *
 * @remarks
 * Re-encoding drops metadata such as camera location. The image is never
 * enlarged, and a decoding failure is a missing avatar, not a failure of the caller.
 */
export async function shrinkAvatarImage(
  bytes: Buffer,
  mimeType: string,
): Promise<ShrunkAvatarImage | null> {
  const size = readImageSize(bytes, mimeType);

  if (
    size === null ||
    size.width < 1 ||
    size.height < 1 ||
    size.width * size.height > MAXIMUM_SOURCE_PIXELS
  ) {
    return null;
  }

  const canvasModule = await loadCanvasModule();
  const image = await decode(canvasModule, bytes);

  if (image === null) {
    return null;
  }

  for (const longestEdge of LONGEST_EDGE_STEPS) {
    const encoded = encodeScaled(canvasModule, image, longestEdge, mimeType);

    if (encoded !== null) {
      return { mimeType, data: encoded };
    }
  }

  return null;
}
