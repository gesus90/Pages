/** A stable release number: `major.minor.patch` without a pre-release or build suffix. */
export type StableVersion = readonly [number, number, number];

const STABLE_VERSION = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,9})$/u;

/**
 * Reads a stable release number.
 * @param text - A version as a release source or a program reported it.
 * @returns The three numbers, or `null` for a pre-release or any other spelling.
 */
export function readStableVersion(text: string): StableVersion | null {
  const match = STABLE_VERSION.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two stable release numbers.
 * @returns A negative number when `left` is older, zero when equal, positive when newer.
 */
export function compareStableVersions(
  left: StableVersion,
  right: StableVersion,
): number {
  for (const index of [0, 1, 2] as const) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Whether a reported version is a stable release at or above a minimum.
 * @param version - The reported version.
 * @param minimum - The oldest release whose protocol Pages implements.
 */
export function isStableVersionAtLeast(
  version: string,
  minimum: string,
): boolean {
  const parsed = readStableVersion(version);
  const floor = readStableVersion(minimum);
  return (
    parsed !== null &&
    floor !== null &&
    compareStableVersions(parsed, floor) >= 0
  );
}

/**
 * Whether a version satisfies a dependency range a package declares.
 * @param version - A stable release number.
 * @param range - An exact version, or a `^`, `~` or `>=` range of one.
 * @returns `null` when the range has another form and cannot be decided here.
 */
export function satisfiesVersionRange(
  version: string,
  range: string,
): boolean | null {
  const parsed = readStableVersion(version);
  const match = /^(\^|~|>=)?\s*(\d+\.\d+\.\d+)$/u.exec(range.trim());
  const base = match ? readStableVersion(match[2]) : null;
  if (!parsed || !match || !base) return null;
  if (compareStableVersions(parsed, base) < 0) return false;
  switch (match[1]) {
    case undefined:
      return compareStableVersions(parsed, base) === 0;
    case ">=":
      return true;
    case "~":
      return parsed[0] === base[0] && parsed[1] === base[1];
    default:
      return caretAllows(parsed, base);
  }
}

// `^` keeps the leftmost non-zero number, as npm defines it.
function caretAllows(version: StableVersion, base: StableVersion): boolean {
  if (base[0] > 0) return version[0] === base[0];
  if (base[1] > 0) return version[0] === 0 && version[1] === base[1];
  return version[0] === 0 && version[1] === 0 && version[2] === base[2];
}
