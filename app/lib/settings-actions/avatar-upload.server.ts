import {
  MAXIMUM_AVATAR_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
} from "@/definition/User";

const MINIMUM_IMAGE_BYTES = 12;

/** An uploaded avatar image validated in memory, before persistence. */
export interface AvatarUpload {
  readonly mimeType: string;
  readonly filename: string;
  readonly data: Buffer;
}

/** The result of validating an avatar upload. */
export type AvatarUploadResult =
  | { readonly status: "ready"; readonly avatar: AvatarUpload }
  | { readonly status: "missing" | "invalid" };

/** Validates that an image buffer begins with the magic bytes for its MIME type. */
function isValidImageBytes(buffer: Buffer, mimeType: string): boolean {
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

/** Strips dangerous characters from an uploaded image filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, "");
}

/**
 * Validates an uploaded avatar file without persisting it.
 *
 * @param value - Raw form value submitted as the avatar.
 * @returns The validated image, or an error when it is missing or invalid.
 */
export async function parseAvatarUpload(
  value: unknown,
): Promise<AvatarUploadResult> {
  if (!(value instanceof File) || value.size === 0) {
    return { status: "missing" };
  }

  if (
    value.size > MAXIMUM_AVATAR_BYTES ||
    !SUPPORTED_AVATAR_MIME_TYPES.has(value.type)
  ) {
    return { status: "invalid" };
  }

  const buffer = Buffer.from(await value.arrayBuffer());

  if (!isValidImageBytes(buffer, value.type)) {
    return { status: "invalid" };
  }

  return {
    avatar: {
      data: buffer,
      filename: sanitizeFilename(value.name) || "avatar",
      mimeType: value.type,
    },
    status: "ready",
  };
}
