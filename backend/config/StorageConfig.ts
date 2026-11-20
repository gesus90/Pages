import type { TomlTable } from "smol-toml";

/** Default instance size warning threshold: 20 decimal gigabytes. */
export const DEFAULT_STORAGE_WARNING_BYTES = 20_000_000_000;

/** Default retention period in days for provider session files and databases. */
export const DEFAULT_STORAGE_RETENTION_DAYS = 30;

const STORAGE_RETENTION_DAY_RANGE = { minimum: 1, maximum: 3650 } as const;

/** Storage warning and retention settings persisted in `config.toml`. */
export interface StorageConfigSetting {
  /** Instance size warning in bytes; missing: 20 GB. */
  readonly storageWarningBytes?: number;
  /** Retention period in days for provider session files and databases; missing: 30 days. */
  readonly storageRetentionDays?: number;
}

function isStorageRetentionDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= STORAGE_RETENTION_DAY_RANGE.minimum &&
    value <= STORAGE_RETENTION_DAY_RANGE.maximum
  );
}

/**
 * Reads storage warning and retention settings from a parsed configuration table.
 * @param table - Parsed TOML document.
 * @returns Validated storage settings; absent keys keep their defaults.
 * @throws {Error} When a key has an invalid type or out-of-range value.
 */
export function readStorageSettings(table: TomlTable): StorageConfigSetting {
  const bytes = table.storageWarningBytes;
  if (
    bytes !== undefined &&
    (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0)
  )
    throw new Error('"storageWarningBytes" must be a positive safe integer.');
  const days = table.storageRetentionDays;
  if (days !== undefined && !isStorageRetentionDays(days))
    throw new Error(
      `"storageRetentionDays" must be a whole number from ${STORAGE_RETENTION_DAY_RANGE.minimum} to ${STORAGE_RETENTION_DAY_RANGE.maximum}.`,
    );
  return {
    ...(bytes === undefined ? {} : { storageWarningBytes: bytes }),
    ...(days === undefined ? {} : { storageRetentionDays: days }),
  };
}
