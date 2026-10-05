/**
 * Computes a default project key prefix from the project display name.
 *
 * @param name - Display name of the project.
 * @returns An uppercase prefix suitable for ticket keys (e.g. "PAGE", "ASTRO", "ANI").
 */
export function generateProjectKey(name: string): string {
  const trimmed = name.trim();

  if (!trimmed) {
    return "TASK";
  }

  const lower = trimmed.toLowerCase();

  if (lower === "pages") {
    return "PAGE";
  }

  if (lower === "astrolab") {
    return "ASTRO";
  }

  if (lower === "animus") {
    return "ANI";
  }

  const words = trimmed.split(/[\s\-_]+/);

  if (words.length > 1) {
    const initials = words
      .map((word) => word.replace(/[^a-zA-Z0-9]/g, "").charAt(0))
      .join("")
      .toUpperCase();

    if (initials.length >= 2) {
      return initials.slice(0, 5);
    }
  }

  const camelParts = trimmed.match(/[A-Z][a-z0-9]*/g);

  if (camelParts && camelParts.length > 1) {
    const first = camelParts[0].toUpperCase();

    if (first.length >= 3) {
      return first;
    }
  }

  const clean = trimmed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  if (clean.length <= 4) {
    return clean;
  }

  return clean.slice(0, 4);
}
