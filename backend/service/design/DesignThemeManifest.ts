import { z } from "zod";

import {
  DESIGN_THEME_COLOR_ROLES,
  DESIGN_THEME_MODES,
  MAXIMUM_DESIGN_THEME_ID_LENGTH,
  isDesignThemeId,
} from "@/definition/DesignTheme";

import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** The only manifest format Pages reads; a newer format is skipped with a reason. */
const SUPPORTED_SCHEMA_VERSION = 1;

const MAXIMUM_NAME_LENGTH = 48;
const MAXIMUM_DESCRIPTION_LENGTH = 200;

const hexColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u,
    "must be a hexadecimal color such as #1a2b3c",
  );

function localizedTextSchema(maximumLength: number): z.ZodObject<{
  de: z.ZodString;
  en: z.ZodString;
}> {
  const text = z.string().trim().min(1).max(maximumLength);

  return z.strictObject({ de: text, en: text });
}

const paletteSchema = z.strictObject(
  Object.fromEntries(
    DESIGN_THEME_COLOR_ROLES.map((role) => [role, hexColorSchema.optional()]),
  ),
);

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  id: z.string().max(MAXIMUM_DESIGN_THEME_ID_LENGTH),
  name: localizedTextSchema(MAXIMUM_NAME_LENGTH),
  description: localizedTextSchema(MAXIMUM_DESCRIPTION_LENGTH),
  modes: z
    .array(z.enum(DESIGN_THEME_MODES))
    .min(1)
    .refine((modes) => new Set(modes).size === modes.length, "must not repeat"),
  colors: z
    .strictObject({
      light: paletteSchema.optional(),
      dark: paletteSchema.optional(),
    })
    .optional(),
  materials: z
    .strictObject({
      radiusScale: z.number().min(0.5).max(2).optional(),
      shadowStrength: z.number().min(0).max(8).optional(),
      shadowEdgeAlpha: z.number().min(0).max(100).optional(),
    })
    .optional(),
  preview: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/iu,
      "must be the name of a PNG, JPEG or WebP file inside the theme directory",
    )
    .optional(),
});

/** The outcome of reading a manifest: the theme, or every reason it was refused. */
export type ManifestParseResult =
  | { readonly manifest: DesignThemeManifest }
  | { readonly problems: readonly string[] };

function describeIssue(issue: z.core.$ZodIssue): string {
  const location = issue.path.join(".");

  return location === "" ? issue.message : `${location}: ${issue.message}`;
}

/**
 * Validates the content of a `theme.json`.
 *
 * @param content - The parsed JSON of the file.
 * @param directoryName - Name of the directory the file lies in; it must equal
 * the `id` of the manifest, so the identifier of a theme is its directory.
 * @returns The manifest, or all problems found, in plain English for the log.
 */
export function parseDesignThemeManifest(
  content: unknown,
  directoryName: string,
): ManifestParseResult {
  const parsed = manifestSchema.safeParse(content);

  if (!parsed.success) {
    return { problems: parsed.error.issues.map(describeIssue) };
  }

  const { data: validated } = parsed;

  if (!isDesignThemeId(validated.id)) {
    return {
      problems: [
        "id: must be lower-case words joined by hyphens and begin with a letter",
      ],
    };
  }

  if (validated.id !== directoryName) {
    return {
      problems: [
        `id: "${validated.id}" must equal the directory name "${directoryName}"`,
      ],
    };
  }

  const unsupportedMode = DESIGN_THEME_MODES.find(
    (mode) =>
      validated.colors?.[mode] !== undefined && !validated.modes.includes(mode),
  );

  if (unsupportedMode) {
    return {
      problems: [`colors.${unsupportedMode}: the mode is not listed in modes`],
    };
  }

  return {
    manifest: {
      id: validated.id,
      name: validated.name,
      description: validated.description,
      modes: validated.modes,
      colors: validated.colors ?? {},
      materials: validated.materials ?? {},
      preview: validated.preview ?? null,
    },
  };
}
