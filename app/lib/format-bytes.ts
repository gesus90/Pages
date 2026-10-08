const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Writes a size in bytes in the largest sensible unit.
 *
 * @param bytes - Size in bytes.
 * @returns For example `512 B`, `1.5 MB` or `42 GB`; one decimal below ten.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const text =
    value < 10 && unit > 0 ? value.toFixed(1) : String(Math.round(value));

  return `${text} ${UNITS[unit]}`;
}
