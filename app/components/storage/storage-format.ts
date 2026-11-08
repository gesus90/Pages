import type { StoragePathEntry } from "@/definition/GoogleDriveStorage";
import type { TFunction } from "i18next";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * Formats a byte count in decimal units, as Google names storage.
 *
 * @param bytes - The count.
 * @param language - The language of the view.
 * @returns For example `4,2 GB`.
 */
export function formatBytes(bytes: number, language: string): string {
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1000 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const formatter = new Intl.NumberFormat(language, {
    maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
  });

  return `${formatter.format(value)} ${BYTE_UNITS[unitIndex] ?? "B"}`;
}

/**
 * Formats the last change of an item.
 *
 * @param isoTime - ISO time from Drive.
 * @param language - The language of the view.
 * @returns A short date and time, or `""` for an unreadable value.
 */
export function formatModified(isoTime: string, language: string): string {
  const time = new Date(isoTime);

  if (Number.isNaN(time.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
}

/**
 * Names a step of the path; the roots are named in the language of the view.
 *
 * @param entry - The step.
 * @param t - Translation function.
 * @returns The readable name.
 */
export function pathEntryLabel(entry: StoragePathEntry, t: TFunction): string {
  if (entry.role === "my_drive") return t("storage.myDrive");
  if (entry.role === "shared_drives") return t("storage.sharedDrives");
  if (entry.role === "detached") return "…";
  return entry.name === "" ? t("storage.untitled") : entry.name;
}

/**
 * Writes a path as one readable line.
 *
 * @param path - The steps from the root.
 * @param t - Translation function.
 * @returns For example `Meine Ablage / Projekte / 2026`.
 */
export function pathText(
  path: readonly StoragePathEntry[],
  t: TFunction,
): string {
  return path.map((entry) => pathEntryLabel(entry, t)).join(" / ");
}

/**
 * Builds the Storage address of a folder; an explicit target is never redirected.
 *
 * @param folderId - The folder, or `null` for the start folder.
 * @returns The address.
 */
export function storageFolderHref(folderId: string | null): string {
  return folderId === null
    ? "/storage"
    : `/storage?folder=${encodeURIComponent(folderId)}`;
}
