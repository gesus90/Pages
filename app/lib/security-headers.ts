/**
 * Content Security Policy of Pages.
 *
 * @remarks
 * React Router renders inline scripts for hydration and React sets inline
 * styles, so both directives allow `'unsafe-inline'`. Everything else is
 * restricted to the own origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Builds the security headers for HTML responses.
 *
 * @returns Header names with their values.
 *
 * @remarks
 * `Strict-Transport-Security` is not part of this set, because it only makes
 * sense behind TLS and a wrong value locks browsers out of plain HTTP.
 */
export function createSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}
