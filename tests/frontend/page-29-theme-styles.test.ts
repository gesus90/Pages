import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/app/lib/document-theme";

import {
  contrastRatio,
  readStylesheet,
  readThemePalettes,
} from "../helpers/theme-css";

const palettes = readThemePalettes();

const APP_DIRECTORY = fileURLToPath(new URL("../../app", import.meta.url));
const STYLESHEET = path.join(APP_DIRECTORY, "styles/tailwind.css");

describe("PAGE-29 palettes", () => {
  it("define the same color roles in the light and the dark palette", () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(
      Object.keys(palettes.light).sort(),
    );
  });

  it("keep the established roles of the light palette", () => {
    for (const role of [
      "background",
      "surface",
      "foreground",
      "muted-foreground",
      "border",
      "primary",
      "primary-foreground",
      "destructive",
      "success",
      "info",
      "warning",
      "column-backlog",
      "column-todo",
      "column-progress",
      "column-review",
      "column-done",
    ]) {
      expect(palettes.light, role).toHaveProperty(role);
      expect(palettes.dark, role).toHaveProperty(role);
    }
  });

  it("keeps the surfaces of the dark palette darker than its text", () => {
    for (const surface of ["background", "surface", "muted", "field"]) {
      expect(
        contrastRatio(
          palettes.dark.foreground ?? "",
          palettes.dark[surface] ?? "",
        ),
        surface,
      ).toBeGreaterThan(7);
    }
  });
});

/** Foreground and background roles that text or controls are drawn with. */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "surface-hover"],
  ["foreground", "muted"],
  ["foreground", "primary-subtle"],
  ["foreground", "field"],
  ["foreground", "sidebar-hover"],
  ["foreground", "column-backlog"],
  ["foreground", "column-todo"],
  ["foreground", "column-progress"],
  ["foreground", "column-review"],
  ["foreground", "column-done"],
  ["foreground", "notice-subtle"],
  ["foreground", "panel-body"],
  ["muted-foreground", "background"],
  ["muted-foreground", "surface"],
  ["muted-foreground", "surface-hover"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "field"],
  ["muted-foreground", "sidebar-hover"],
  ["muted-foreground", "column-backlog"],
  ["muted-foreground", "column-todo"],
  ["muted-foreground", "column-progress"],
  ["muted-foreground", "column-review"],
  ["muted-foreground", "column-done"],
  ["muted-foreground", "panel-body"],
  ["primary", "background"],
  ["primary", "surface"],
  ["primary", "primary-subtle"],
  ["primary", "muted"],
  ["primary", "column-todo"],
  ["primary", "column-progress"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["primary-foreground", "destructive"],
  ["destructive", "background"],
  ["destructive", "surface"],
  ["destructive", "destructive-subtle"],
  ["destructive", "muted"],
  ["success", "surface"],
  ["success", "success-subtle"],
  ["success", "background"],
  ["success", "muted"],
  ["info", "surface"],
  ["info", "info-subtle"],
  ["info", "background"],
  ["warning", "surface"],
  ["warning", "warning-subtle"],
  ["warning", "background"],
  ["initiative", "initiative-subtle"],
  ["initiative", "surface"],
  ["epic", "epic-subtle"],
  ["epic", "surface"],
  ["priority-urgent", "surface"],
  ["priority-high", "surface"],
  ["priority-low", "surface"],
  ["priority-urgent", "column-todo"],
  ["priority-high", "column-progress"],
  ["priority-low", "column-done"],
  ["notice", "notice-chip"],
  ["notice", "surface"],
  ["avatar-sand-foreground", "avatar-sand"],
  ["avatar-slate-foreground", "avatar-slate"],
  ["avatar-peach-foreground", "avatar-peach"],
  ["avatar-sage-foreground", "avatar-sage"],
  ["avatar-lilac-foreground", "avatar-lilac"],
];

/** Roles of graphics and focus indicators, which WCAG 1.4.11 asks 3:1 for. */
const GRAPHIC_PAIRS: readonly (readonly [string, string])[] = [
  ["ring", "surface"],
  ["ring", "background"],
  ["primary", "surface"],
  ["success-dot", "surface"],
  ["muted-foreground", "surface"],
];

/**
 * Pairs of the light palette that stay below WCAG 2.1 AA.
 *
 * @remarks
 * They predate the dark theme and PAGE-29 keeps the light palette unchanged,
 * so they are reported and listed here instead of being corrected. The test
 * below demands this list to match the palette exactly: a new shortfall
 * fails it, and so does a fixed pair that is still listed.
 */
const KNOWN_LIGHT_SHORTFALLS: readonly string[] = [
  "muted-foreground|background",
  "muted-foreground|surface-hover",
  "muted-foreground|muted",
  "muted-foreground|field",
  "muted-foreground|sidebar-hover",
  "muted-foreground|column-backlog",
  "muted-foreground|column-todo",
  "muted-foreground|column-progress",
  "muted-foreground|column-review",
  "muted-foreground|column-done",
  "muted-foreground|panel-body",
  "primary|background",
  "primary|surface",
  "primary|primary-subtle",
  "primary|muted",
  "primary|column-todo",
  "primary|column-progress",
  "primary-foreground|primary",
  "primary-foreground|primary-hover",
  "priority-high|surface",
  "priority-low|surface",
  "priority-urgent|column-todo",
  "priority-high|column-progress",
  "priority-low|column-done",
  "ring|surface",
  "ring|background",
  "primary|surface",
  "success-dot|surface",
  "avatar-peach-foreground|avatar-peach",
];

const TEXT_MINIMUM = 4.5;
const GRAPHIC_MINIMUM = 3;

function findShortfalls(
  palette: Readonly<Record<string, string>>,
): { pair: string; ratio: number }[] {
  const checks = [
    ...TEXT_PAIRS.map((pair) => ({ minimum: TEXT_MINIMUM, pair })),
    ...GRAPHIC_PAIRS.map((pair) => ({ minimum: GRAPHIC_MINIMUM, pair })),
  ];

  return checks.flatMap(({ minimum, pair: [foreground, background] }) => {
    const foregroundColor = palette[foreground ?? ""];
    const backgroundColor = palette[background ?? ""];

    if (foregroundColor === undefined || backgroundColor === undefined) {
      throw new Error(`Unknown role in ${foreground}|${background}.`);
    }

    const ratio = contrastRatio(foregroundColor, backgroundColor);

    return ratio >= minimum
      ? []
      : [{ pair: `${foreground}|${background}`, ratio }];
  });
}

describe("PAGE-29 contrast (WCAG 2.1 AA)", () => {
  it("meets 4.5:1 for text and 3:1 for graphics in every dark pair", () => {
    expect(findShortfalls(palettes.dark)).toEqual([]);
  });

  it("lists exactly the pairs of the light palette that stay below AA", () => {
    const shortfalls = findShortfalls(palettes.light).map(
      (shortfall) => shortfall.pair,
    );

    expect([...new Set(shortfalls)].sort()).toEqual(
      [...new Set(KNOWN_LIGHT_SHORTFALLS)].sort(),
    );
  });

  it("keeps focus, hover, selection and status distinguishable from the surface", () => {
    const { dark } = palettes;

    // Focus ring and primary selection are drawn in an accent, hover and
    // selected rows as a step on the surface scale.
    expect(contrastRatio(dark.ring ?? "", dark.surface ?? "")).toBeGreaterThan(
      3,
    );
    expect(dark["surface-hover"]).not.toBe(dark.surface);
    expect(dark["sidebar-hover"]).not.toBe(dark.background);
    expect(dark["primary-subtle"]).not.toBe(dark.surface);
    expect(dark.muted).not.toBe(dark.surface);
  });
});

describe("PAGE-29 stylesheet structure", () => {
  const css = readStylesheet();

  it("lets an explicit dark theme win and `system` follow the operating system", () => {
    expect(css).toContain("@custom-variant dark {");
    expect(css).toContain(
      '&:where([data-theme="dark"], [data-theme="dark"] *)',
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*&:where\(\[data-theme="system"\], \[data-theme="system"\] \*\)/u,
    );
  });

  it("never applies the dark palette to an explicit light theme", () => {
    const variant = /@custom-variant dark \{[\s\S]*?\n\}/u.exec(css)?.[0];

    expect(variant).toBeDefined();
    expect(variant).not.toMatch(/light/u);
  });

  it("declares the color scheme of both palettes for native controls", () => {
    expect(css).toMatch(/:root \{\s*color-scheme: light;/u);
    expect(css).toMatch(/@variant dark \{\s*color-scheme: dark;/u);
  });

  it("derives the plain custom properties from the color tokens", () => {
    expect(css).toContain("--surface: var(--color-surface);");
    expect(css).toContain("--background: var(--color-background);");
  });

  it("matches the browser chrome colors of the document", () => {
    expect(THEME_COLORS.light).toBe(palettes.light.surface);
    expect(THEME_COLORS.dark).toBe(palettes.dark.background);
  });
});

/**
 * Files that may name colors outside the theme tokens, with the reason.
 *
 * @remarks
 * Everything else takes its colors from the tokens of `tailwind.css`, so a
 * new color has to be a token that both palettes define.
 */
const COLOR_LITERAL_ALLOWLIST: Readonly<Record<string, string>> = {
  "components/dashboard/dashboard-kpi-card.tsx":
    "trend icon, 500-level green readable on both surfaces",
  "components/projects/general-goals-section.tsx":
    "done label, 600-level green readable on both surfaces",
  "components/projects/integration-fields.tsx":
    "toggle track and knob, check icon: mid-tone, readable on both surfaces",
  "components/projects/integration-service-icon.tsx":
    "third-party brand colors, not recolored",
  "components/projects/overview/project-status-badge.tsx":
    "status dots next to their label",
  "components/projects/phase-plan/symbol-color-picker.tsx":
    "placeholder text of the hex field, no color",
  "components/projects/phase-plan/timeline-milestone.tsx":
    "white symbol on the color a user chose",
  "components/projects/project-status-pill.tsx":
    "status dots next to their label",
  "components/settings/toggle-row.tsx": "white knob of a switch",
  "components/tasks/detail/detail-children-section.tsx":
    "done icon next to a done ticket",
  "components/tasks/detail/detail-path-section.tsx":
    "path dots, shaped by their ticket type",
  "components/tasks/github-sync-badge.tsx": "sync dot with a text alternative",
  "components/tasks/hexagon-color-picker/hex-color-field.tsx":
    "edge of a swatch of a user color",
  "components/tasks/hexagon-color-picker/hue-slider.tsx":
    "the hue scale of the color picker",
  "components/tasks/hexagon-color-picker/saturation-pad.tsx":
    "the saturation field of the color picker",
  "components/tasks/hierarchy/hierarchy-row-toggle.tsx":
    "done icon next to a done ticket",
  "components/tasks/kanban/kanban-ticket-card.tsx":
    "done dot next to a done ticket",
  "components/tasks/label-color.ts":
    "fallback text for labels in a light color, and the default color",
  "components/tasks/label-editor/label-color-presets.tsx":
    "check mark on the label colors a user picks from",
  "components/tasks/label-picker/label-row.tsx":
    "edge of a swatch of a user color",
  "components/tasks/task-badges.tsx": "workflow status dots next to their name",
  "components/tasks/task-links/link-row.tsx": "done icon next to a done ticket",
  "lib/document-theme.ts": "browser chrome colors, kept equal to the tokens",
  "lib/phase-plan/plan-colors.ts": "colors a user picks for milestones",
  "lib/phase-plan/plan-milestones.ts": "colors a user picks for milestones",
  "lib/project-overview-actions.server.ts":
    "pastel colors assigned to new projects",
};

const PALETTE_NAMES =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY_PREFIXES =
  "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder";
const COLOR_LITERAL = new RegExp(
  [
    "#[0-9a-fA-F]{3,8}\\b",
    "\\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\\(",
    `(?<![\\w-])(?:${UTILITY_PREFIXES})-(?:${PALETTE_NAMES})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
  ].join("|"),
  "u",
);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);

    if (statSync(entry).isDirectory()) {
      return listSourceFiles(entry);
    }

    return /\.(?:ts|tsx|css)$/u.test(name) ? [entry] : [];
  });
}

describe("PAGE-29 color literals", () => {
  const sources = listSourceFiles(APP_DIRECTORY)
    .filter((file) => file !== STYLESHEET)
    .map((file) => ({
      relative: path.relative(APP_DIRECTORY, file).split(path.sep).join("/"),
      text: readFileSync(file, "utf8"),
    }));

  it("keeps new colors out of components, they belong to the theme tokens", () => {
    const offenders = sources
      .filter(
        ({ relative, text }) =>
          COLOR_LITERAL.test(text) && !(relative in COLOR_LITERAL_ALLOWLIST),
      )
      .map(({ relative }) => relative);

    expect(offenders).toEqual([]);
  });

  it("lists only files that still hold such a color", () => {
    const stale = Object.keys(COLOR_LITERAL_ALLOWLIST).filter((relative) => {
      const source = sources.find(
        (candidate) => candidate.relative === relative,
      );

      return source === undefined || !COLOR_LITERAL.test(source.text);
    });

    expect(stale).toEqual([]);
  });
});
