import { DESIGN_THEME_COLOR_ROLES } from "@/definition/DesignTheme";

import type {
  DesignThemeManifest,
  DesignThemeMaterials,
  DesignThemeMode,
  DesignThemePalette,
} from "@/definition/DesignTheme";

/**
 * Selectors under which the palette of a mode applies.
 *
 * @remarks
 * The color mode sits in `data-theme` of the document: `light` and `dark`
 * are explicit, `system` follows the operating system. A theme palette
 * applies only while its mode is in effect, so the other mode keeps the
 * Standard design. The attribute selectors outrank the `:root` rules of the
 * base stylesheet, whatever the order of the two stylesheets is.
 */
const MODE_CONDITIONS: Readonly<
  Record<DesignThemeMode, { explicit: string; systemQuery: string }>
> = {
  light: {
    explicit: '[data-theme="light"]',
    systemQuery: "not (prefers-color-scheme: dark)",
  },
  dark: {
    explicit: '[data-theme="dark"]',
    systemQuery: "(prefers-color-scheme: dark)",
  },
};

function paletteDeclarations(palette: DesignThemePalette): string[] {
  return DESIGN_THEME_COLOR_ROLES.flatMap((role) => {
    const color = palette[role];

    return color === undefined ? [] : [`--color-${role}: ${color};`];
  });
}

function materialDeclarations(materials: DesignThemeMaterials): string[] {
  const declarations: string[] = [];

  if (materials.shadowStrength !== undefined) {
    declarations.push(`--shadow-strength: ${materials.shadowStrength};`);
  }

  if (materials.shadowEdgeAlpha !== undefined) {
    declarations.push(`--shadow-edge-alpha: ${materials.shadowEdgeAlpha}%;`);
  }

  return declarations;
}

function rule(selector: string, declarations: readonly string[]): string {
  return `${selector} {\n  ${declarations.join("\n  ")}\n}`;
}

function modeRules(
  base: string,
  mode: DesignThemeMode,
  declarations: readonly string[],
): string[] {
  if (declarations.length === 0) {
    return [];
  }

  const { explicit, systemQuery } = MODE_CONDITIONS[mode];

  return [
    rule(`${base}${explicit}`, declarations),
    `@media ${systemQuery} {\n${rule(`${base}[data-theme="system"]`, declarations)}\n}`,
  ];
}

/**
 * Declarations a theme that ships with Pages adds to its mode rules, such as
 * the texture of the sidebar, which no color role can express.
 */
export type ShippedDesignThemeDeclarations = Readonly<
  Partial<Record<DesignThemeMode, readonly string[]>>
>;

/**
 * Builds the stylesheet that applies a theme.
 *
 * @param manifest - A validated manifest; colors and numbers are therefore
 * known to be plain hexadecimal colors and finite numbers.
 * @param shipped - Further custom properties per mode. Only a theme that ships
 * with Pages passes them; the manifest of an installed theme has no way to.
 * @returns The CSS, or `null` when the theme overrides nothing.
 *
 * @remarks
 * Only the custom properties of the color and material roles are set, never
 * a selector or a value from the file, so a manifest cannot inject styles.
 */
export function buildDesignThemeStylesheet(
  manifest: DesignThemeManifest,
  shipped: ShippedDesignThemeDeclarations = {},
): string | null {
  const base = `:root[data-design-theme="${manifest.id}"]`;
  const materials = materialDeclarations(manifest.materials);
  const rules = [
    ...(materials.length > 0 ? [rule(base, materials)] : []),
    ...manifest.modes.flatMap((mode) =>
      modeRules(base, mode, [
        ...paletteDeclarations(manifest.colors[mode] ?? {}),
        ...(shipped[mode] ?? []),
      ]),
    ),
  ];

  return rules.length === 0 ? null : `${rules.join("\n")}\n`;
}
