import { renderManagementAvatar } from "@/backend/service/management/ManagementAvatar";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
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
 * Validates the bytes of an avatar image with the limits of profile images.
 *
 * @param image - The bytes, the announced type and the original file name.
 * @returns The validated image, or `invalid` for a wrong type, size or content.
 */
export function validateAvatarImage(image: {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly filename: string;
}): AvatarUploadResult {
  if (
    image.data.length === 0 ||
    image.data.length > MAXIMUM_AVATAR_BYTES ||
    !SUPPORTED_AVATAR_MIME_TYPES.has(image.mimeType) ||
    !hasImageSignature(image.data, image.mimeType)
  ) {
    return { status: "invalid" };
  }

  return {
    avatar: {
      data: image.data,
      filename: sanitizeFilename(image.filename) || "avatar",
      mimeType: image.mimeType,
    },
    status: "ready",
  };
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
    (!SUPPORTED_AVATAR_MIME_TYPES.has(value.type) &&
      value.type !== "image/svg+xml")
  ) {
    return { status: "invalid" };
  }

  if (value.type === "image/svg+xml") {
    try {
      const avatar = await renderManagementAvatar(
        value.type,
        Buffer.from(await value.arrayBuffer()).toString("base64"),
      );
      return { status: "ready", avatar };
    } catch (error: unknown) {
      if (error instanceof AgentOperationError) return { status: "invalid" };
      throw error;
    }
  }
  return validateAvatarImage({
    data: Buffer.from(await value.arrayBuffer()),
    mimeType: value.type,
    filename: value.name,
  });
}
