import { STANDARD_PREVIEW_PALETTES } from "./StandardDesignTheme";

import type {
  DesignThemeChoice,
  DesignThemeManifest,
  DesignThemeMode,
  DesignThemePalette,
  DesignThemePreviewPalette,
} from "@/definition/DesignTheme";

/** The roles a preview card draws and the key each one has in its palette. */
const PREVIEW_ROLES = [
  ["background", "background"],
  ["sidebar", "sidebar"],
  ["surface", "surface"],
  ["foreground", "foreground"],
  ["muted-foreground", "mutedForeground"],
  ["border", "border"],
  ["primary", "primary"],
] as const;

function resolvePreviewPalette(
  mode: DesignThemeMode,
  overrides: DesignThemePalette | undefined,
): DesignThemePreviewPalette {
  const palette = { ...STANDARD_PREVIEW_PALETTES[mode] };

  for (const [role, key] of PREVIEW_ROLES) {
    const color = overrides?.[role];

    if (color !== undefined) {
      palette[key] = color;
    }
  }

  return palette;
}

/**
 * Describes a theme the way the settings page offers it.
 *
 * @param manifest - A validated manifest.
 * @param previewImageUrl - Address of its preview image, if it has one.
 * @returns The choice, with the colors of every supported mode completed by
 * the Standard design where the theme leaves a role open.
 */
export function toDesignThemeChoice(
  manifest: DesignThemeManifest,
  previewImageUrl: string | null,
): DesignThemeChoice {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    modes: manifest.modes,
    preview: Object.fromEntries(
      manifest.modes.map((mode) => [
        mode,
        resolvePreviewPalette(mode, manifest.colors[mode]),
      ]),
    ),
    previewImageUrl,
  };
}
