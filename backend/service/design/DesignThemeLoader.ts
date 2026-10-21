import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";
import { parseDesignThemeManifest } from "./DesignThemeManifest";

import type { Stats } from "node:fs";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** Name of the manifest inside every theme directory. */
export const MANIFEST_FILE_NAME = "theme.json";

const MAXIMUM_MANIFEST_BYTES = 64 * 1024;
const MAXIMUM_PREVIEW_IMAGE_BYTES = 1024 * 1024;

/** A theme read from its directory, with what is needed to serve and to recognize it. */
export interface InstalledDesignTheme {
  readonly manifest: DesignThemeManifest;
  /** The CSS that applies the theme; `null` when it overrides nothing. */
  readonly stylesheet: string | null;
  /** Absolute path of the preview image, if the manifest names one. */
  readonly previewImagePath: string | null;
  /** Changes whenever the manifest or its preview image changes on disk. */
  readonly signature: string;
}

/** The outcome of reading one theme directory. */
export type DesignThemeLoadResult =
  | { readonly theme: InstalledDesignTheme }
  | {
      readonly problems: readonly string[];
      /** Whether the directory has no manifest at all, as after a removal. */
      readonly isManifestMissing?: boolean;
    };

/**
 * Stats a path.
 *
 * @param target - Path to look at.
 * @returns Its stats, or `null` when it does not exist.
 */
export async function statIfPresent(target: string): Promise<Stats | null> {
  try {
    return await stat(target);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * Names why a file system call failed, without paths or messages of the system.
 *
 * @param error - What the call threw.
 * @returns The error code, such as `EACCES`.
 */
export function describeFileError(error: unknown): string {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "unknown error";
}

function describeFile(stats: Stats): string {
  return `${stats.mtimeMs}:${stats.size}`;
}

/**
 * Describes a theme by the facts that change when somebody edits its files.
 *
 * @param manifest - Stats of `theme.json`.
 * @param preview - Stats of the preview image, if the theme has one.
 * @returns A text that differs after an edit of either file.
 */
export function themeSignature(manifest: Stats, preview: Stats | null): string {
  return preview === null
    ? describeFile(manifest)
    : `${describeFile(manifest)}|${describeFile(preview)}`;
}

async function readManifestContent(
  manifestPath: string,
  stats: Stats,
): Promise<{ readonly content: unknown } | { readonly problem: string }> {
  if (!stats.isFile()) {
    return { problem: `${MANIFEST_FILE_NAME} is not a file` };
  }

  if (stats.size > MAXIMUM_MANIFEST_BYTES) {
    return {
      problem: `${MANIFEST_FILE_NAME} is larger than ${MAXIMUM_MANIFEST_BYTES} bytes`,
    };
  }

  try {
    return { content: JSON.parse(await readFile(manifestPath, "utf8")) };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        problem: `${MANIFEST_FILE_NAME} is not valid JSON (${error.message})`,
      };
    }

    throw error;
  }
}

async function checkPreviewImage(
  imagePath: string,
  fileName: string,
): Promise<{ readonly stats: Stats } | { readonly problem: string }> {
  const stats = await statIfPresent(imagePath);

  if (!stats?.isFile()) {
    return { problem: `preview: the file "${fileName}" does not exist` };
  }

  if (stats.size > MAXIMUM_PREVIEW_IMAGE_BYTES) {
    return {
      problem: `preview: "${fileName}" is larger than ${MAXIMUM_PREVIEW_IMAGE_BYTES} bytes`,
    };
  }

  return { stats };
}

/**
 * Reads and validates one theme directory.
 *
 * @param directory - Directory that holds the themes.
 * @param directoryName - Name of the theme directory; it is the theme's identifier.
 * @returns The theme, or every reason the directory is not a usable theme.
 * @throws When the file system fails for another reason than a missing file.
 */
export async function loadDesignTheme(
  directory: string,
  directoryName: string,
): Promise<DesignThemeLoadResult> {
  const themeDirectory = path.join(directory, directoryName);
  const manifestPath = path.join(themeDirectory, MANIFEST_FILE_NAME);
  const stats = await statIfPresent(manifestPath);

  if (!stats) {
    return {
      isManifestMissing: true,
      problems: [`${MANIFEST_FILE_NAME} is missing`],
    };
  }

  const read = await readManifestContent(manifestPath, stats);

  if ("problem" in read) {
    return { problems: [read.problem] };
  }

  const parsed = parseDesignThemeManifest(read.content, directoryName);

  if ("problems" in parsed) {
    return parsed;
  }

  const { manifest } = parsed;

  if (manifest.preview === null) {
    return {
      theme: {
        manifest,
        previewImagePath: null,
        signature: themeSignature(stats, null),
        stylesheet: buildDesignThemeStylesheet(manifest),
      },
    };
  }

  // The manifest pattern allows a plain file name only, so the path stays inside the theme.
  const previewImagePath = path.join(themeDirectory, manifest.preview);
  const preview = await checkPreviewImage(previewImagePath, manifest.preview);

  if ("problem" in preview) {
    return { problems: [preview.problem] };
  }

  return {
    theme: {
      manifest,
      previewImagePath,
      signature: themeSignature(stats, preview.stats),
      stylesheet: buildDesignThemeStylesheet(manifest),
    },
  };
}
