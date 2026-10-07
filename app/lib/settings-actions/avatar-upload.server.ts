import {
  MAXIMUM_AVATAR_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
} from "@/definition/User";

import { hasImageSignature } from "./image-signature.server";

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

  if (!hasImageSignature(buffer, value.type)) {
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
