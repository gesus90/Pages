/**
 * Returns a redirect target that stays on this site.
 *
 * @param value - Untrusted target taken from a form field.
 * @param fallback - Target used when the value is not a local path.
 * @returns The value when it is an absolute path of this site, otherwise the
 * fallback.
 *
 * @remarks
 * A leading `//` or `/\` is read by browsers as another host, and control
 * characters allow header injection, so none of them count as local paths.
 */
export function resolveLocalRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }

  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  return /[\u0000-\u001f\u007f]/u.test(value) ? fallback : value;
}
