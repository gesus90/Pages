import {
  MAXIMUM_LOGO_BYTES,
  SUPPORTED_LOGO_MIME_TYPES,
} from "@/definition/Instance";

import { hasImageSignature } from "./image-signature.server";
import { isSafeSvg } from "./svg-safety.server";

const SVG_MIME_TYPE = "image/svg+xml";

/** An uploaded company logo validated in memory, before persistence. */
export interface LogoUpload {
  readonly mimeType: string;
  readonly data: Buffer;
}

/** The result of validating a logo upload. */
export type LogoUploadResult =
  | { readonly status: "ready"; readonly logo: LogoUpload }
  | { readonly status: "missing" | "invalid" };

/**
 * Validates an uploaded company logo without persisting it.
 *
 * @param value - Raw form value submitted as the logo.
 * @returns The validated image, or why it was not accepted.
 *
 * @remarks
 * A raster image has to begin with the magic bytes of its type; an SVG has to
 * be plain artwork without active content.
 */
export async function parseLogoUpload(
  value: unknown,
): Promise<LogoUploadResult> {
  if (!(value instanceof File) || value.size === 0) {
    return { status: "missing" };
  }

  if (
    value.size > MAXIMUM_LOGO_BYTES ||
    !SUPPORTED_LOGO_MIME_TYPES.has(value.type)
  ) {
    return { status: "invalid" };
  }

  const bytes = Buffer.from(await value.arrayBuffer());
  const isValid =
    value.type === SVG_MIME_TYPE
      ? isSafeSvg(bytes)
      : hasImageSignature(bytes, value.type);

  return isValid
    ? { logo: { data: bytes, mimeType: value.type }, status: "ready" }
    : { status: "invalid" };
}
