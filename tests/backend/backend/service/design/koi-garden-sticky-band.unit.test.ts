import { describe, expect, it } from "vitest";

import { ARCTIC_ICE_INSTALLED_THEME } from "@/backend/service/design/ArcticIceDesignTheme";
import { JUNGLE_BOTANICAL_INSTALLED_THEME } from "@/backend/service/design/JungleBotanicalDesignTheme";
import { KOI_GARDEN_INSTALLED_THEME } from "@/backend/service/design/KoiGardenDesignTheme";
import { NEURAL_RGB_INSTALLED_THEME } from "@/backend/service/design/NeuralRgbDesignTheme";

/**
 * The rule bodies of a stylesheet, keyed by their selector; a rule inside a
 * media query is keyed by the query and the selector.
 */
function rulesOf(stylesheet: string): ReadonlyMap<string, string> {
  const rules = new Map<string, string>();
  const pattern = /(?:@media ([^{]+)\{\s*)?([^{}@]+?)\s*\{([^{}]*)\}/gu;

  for (const [, media, selector = "", body = ""] of stylesheet.matchAll(
    pattern,
  )) {
    const key = selector.trim();

    rules.set(media === undefined ? key : `${media.trim()} ${key}`, body);
  }

  return rules;
}

const KOI_BASE = ':root[data-design-theme="koi-garden"]';

const SYSTEM_QUERIES = {
  dark: "(prefers-color-scheme: dark)",
  light: "not (prefers-color-scheme: dark)",
} as const;

/** The rule bodies of Koi Garden for one palette, explicit and "system". */
function koiPaletteRules(mode: "light" | "dark"): readonly string[] {
  const rules = rulesOf(KOI_GARDEN_INSTALLED_THEME.stylesheet ?? "");
  const bodies = [
    rules.get(`${KOI_BASE}[data-theme="${mode}"]`),
    rules.get(`${SYSTEM_QUERIES[mode]} ${KOI_BASE}[data-theme="system"]`),
  ];

  return bodies.filter((body): body is string => body !== undefined);
}

describe("PAGE-324: the sticky heading of Koi Garden lies on the veil", () => {
  it.each(["light", "dark"] as const)(
    "the %s palette points the stuck surface and its fade at the veil",
    (mode) => {
      const rules = koiPaletteRules(mode);

      expect(rules).toHaveLength(2);
      for (const body of rules) {
        expect(body).toContain("--sticky-band-surface: var(--scene-veil);");
        expect(body).toContain(
          "--sticky-band-filter: var(--scene-veil-filter);",
        );
        // At rest the heading stays invisible; only stuck it shows the veil.
        expect(body).toContain("--sticky-band-rest-opacity: 0;");
        expect(body).toContain("--scene-veil-filter: blur(8px);");
        expect(body).toMatch(
          /--scene-veil: color-mix\(in srgb, var\(--color-background\) \d+%, transparent\);/u,
        );
      }
    },
  );

  it.each([
    ["Arctic Ice", ARCTIC_ICE_INSTALLED_THEME.stylesheet],
    ["Jungle Botanical", JUNGLE_BOTANICAL_INSTALLED_THEME.stylesheet],
    ["Neural RGB", NEURAL_RGB_INSTALLED_THEME.stylesheet],
  ])(
    "%s has no painting and keeps the opaque default surface",
    (name, stylesheet) => {
      expect(stylesheet ?? "", name).not.toContain("--sticky-band-surface");
      expect(stylesheet ?? "").not.toContain("--sticky-band-filter");
      expect(stylesheet ?? "").not.toContain("--app-scene-display: block");
    },
  );
});
