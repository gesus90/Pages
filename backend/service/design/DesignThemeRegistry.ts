import { readdir } from "node:fs/promises";
import path from "node:path";

import { logDiagnostic } from "@/backend/logging/Logger";
import {
  STANDARD_DESIGN_THEME_ID,
  isDesignThemeId,
} from "@/definition/DesignTheme";

import { ARCTIC_ICE_INSTALLED_THEME } from "./ArcticIceDesignTheme";
import {
  MANIFEST_FILE_NAME,
  describeFileError,
  loadDesignTheme,
  statIfPresent,
  themeSignature,
} from "./DesignThemeLoader";
import { STANDARD_DESIGN_THEME } from "./StandardDesignTheme";

import type {
  DesignThemeLoadResult,
  InstalledDesignTheme,
} from "./DesignThemeLoader";
import type { SkippedDesignTheme } from "@/definition/DesignTheme";

/** The installed themes and the directories that were skipped, as of one scan. */
export interface DesignThemeCatalog {
  /** The designs Pages ships first, then the installed themes by identifier. */
  readonly themes: readonly InstalledDesignTheme[];
  readonly skipped: readonly SkippedDesignTheme[];
}

const STANDARD_INSTALLED_THEME: InstalledDesignTheme = {
  manifest: STANDARD_DESIGN_THEME,
  previewImagePath: null,
  signature: STANDARD_DESIGN_THEME_ID,
  stylesheet: null,
};

/** The designs that come with Pages, in the order the settings offer them. */
const SHIPPED_THEMES: readonly InstalledDesignTheme[] = [
  STANDARD_INSTALLED_THEME,
  ARCTIC_ICE_INSTALLED_THEME,
];

function findShippedTheme(id: string): InstalledDesignTheme | undefined {
  return SHIPPED_THEMES.find((theme) => theme.manifest.id === id);
}

const RESERVED_ID_PROBLEM =
  "the identifier is reserved for a design Pages ships";
const INVALID_ID_PROBLEM =
  "the directory name is not a valid theme identifier (lower-case words joined by hyphens, beginning with a letter)";

/**
 * Knows the design themes that are installed in one directory.
 *
 * @remarks
 * A theme is a sub-directory with a `theme.json`; its name is the theme's
 * identifier. The directory is read when somebody asks, never only at start,
 * so a theme appears and disappears without a restart. A theme that did not
 * change on disk is not parsed again, which keeps the check that every page
 * makes for the theme of its user down to one `stat`. The designs Pages ships
 * (Standard and Arctic Ice) are built in, so they exist even when the
 * directory does not, and an installed theme cannot take their identifiers. A
 * directory that cannot be read never breaks a page: the affected theme is
 * skipped and the Standard design applies.
 */
export class DesignThemeRegistry {
  private readonly directory: string;
  private readonly cache = new Map<string, InstalledDesignTheme>();
  private readonly reportedProblems = new Map<string, string>();

  /**
   * Creates a registry.
   *
   * @param directory - Directory that holds the theme directories; it need not exist.
   */
  public constructor(directory: string) {
    this.directory = directory;
  }

  /**
   * Scans the directory again.
   *
   * @returns Every usable theme and every directory that was skipped, with the reason.
   */
  public async list(): Promise<DesignThemeCatalog> {
    const names = await this.readThemeDirectoryNames();
    const themes: InstalledDesignTheme[] = [...SHIPPED_THEMES];
    const skipped: SkippedDesignTheme[] = [];

    for (const name of names) {
      const result = await this.refresh(name, { reportMissingManifest: true });

      if ("theme" in result) {
        themes.push(result.theme);
      } else {
        skipped.push({ directory: name, reason: result.problems.join("; ") });
      }
    }

    this.forgetRemoved(names);

    return { themes, skipped };
  }

  /**
   * Looks up one theme.
   *
   * @param id - Identifier to look for; any text is safe, it is checked first.
   * @returns The theme, or `null` when it is not installed, was removed, or its
   * manifest is invalid.
   */
  public async find(id: string): Promise<InstalledDesignTheme | null> {
    const shipped = findShippedTheme(id);

    if (shipped) {
      return shipped;
    }

    if (!isDesignThemeId(id)) {
      return null;
    }

    // A removed theme is expected, not a problem worth a log entry.
    const result = await this.refresh(id, { reportMissingManifest: false });

    return "theme" in result ? result.theme : null;
  }

  private async readThemeDirectoryNames(): Promise<string[]> {
    try {
      return await this.scanThemeDirectoryNames();
    } catch (error: unknown) {
      logDiagnostic(
        "DesignThemeRegistry",
        "error",
        `[pages] The design theme directory could not be read (${describeFileError(error)}); only the Standard design is offered.`,
        error,
      );

      return [];
    }
  }

  private async scanThemeDirectoryNames(): Promise<string[]> {
    if ((await statIfPresent(this.directory)) === null) {
      return [];
    }

    const entries = await readdir(this.directory, { withFileTypes: true });
    const names: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const target = path.join(this.directory, entry.name);

      if (
        entry.isDirectory() ||
        (await this.isLinkToDirectory(entry, target))
      ) {
        names.push(entry.name);
      }
    }

    return names.sort();
  }

  private async isLinkToDirectory(
    entry: { isSymbolicLink: () => boolean },
    target: string,
  ): Promise<boolean> {
    return (
      entry.isSymbolicLink() &&
      ((await statIfPresent(target))?.isDirectory() ?? false)
    );
  }

  private async refresh(
    name: string,
    options: { readonly reportMissingManifest: boolean },
  ): Promise<DesignThemeLoadResult> {
    if (findShippedTheme(name)) {
      return this.reject(name, [RESERVED_ID_PROBLEM], true);
    }

    if (!isDesignThemeId(name)) {
      return this.reject(name, [INVALID_ID_PROBLEM], true);
    }

    try {
      return await this.loadIfChanged(name, options);
    } catch (error: unknown) {
      return this.reject(
        name,
        [`the theme could not be read (${describeFileError(error)})`],
        true,
      );
    }
  }

  private async loadIfChanged(
    name: string,
    options: { readonly reportMissingManifest: boolean },
  ): Promise<DesignThemeLoadResult> {
    const cached = this.cache.get(name);

    if (cached && (await this.isCurrent(name, cached))) {
      return { theme: cached };
    }

    const result = await loadDesignTheme(this.directory, name);

    if ("problems" in result) {
      const isReported =
        options.reportMissingManifest || result.isManifestMissing !== true;

      return this.reject(name, result.problems, isReported);
    }

    this.cache.set(name, result.theme);
    this.reportedProblems.delete(name);

    return result;
  }

  private async isCurrent(
    name: string,
    cached: InstalledDesignTheme,
  ): Promise<boolean> {
    const manifest = await statIfPresent(
      path.join(this.directory, name, MANIFEST_FILE_NAME),
    );

    if (!manifest) {
      return false;
    }

    if (cached.previewImagePath === null) {
      return themeSignature(manifest, null) === cached.signature;
    }

    const preview = await statIfPresent(cached.previewImagePath);

    return (
      preview !== null && themeSignature(manifest, preview) === cached.signature
    );
  }

  private reject(
    name: string,
    problems: readonly string[],
    isReported: boolean,
  ): { readonly problems: readonly string[] } {
    const reason = problems.join("; ");

    this.cache.delete(name);

    // Report a refusal once per reason, not on every page that asks.
    if (isReported && this.reportedProblems.get(name) !== reason) {
      this.reportedProblems.set(name, reason);
      logDiagnostic(
        "DesignThemeRegistry",
        "warn",
        `[pages] Design theme directory "${name}" was skipped: ${reason}.`,
      );
    }

    return { problems };
  }

  private forgetRemoved(names: readonly string[]): void {
    for (const known of [
      ...this.cache.keys(),
      ...this.reportedProblems.keys(),
    ]) {
      if (!names.includes(known)) {
        this.cache.delete(known);
        this.reportedProblems.delete(known);
      }
    }
  }
}
