import { normalizePagePath } from "../service-worker/install-service-worker";

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
 * sense behind TLS and a wrong value locks browsers out of plain HTTP. The
 * microphone is left to the own origin for the voice messages of the chat
 * (PAGE-277); the browser still asks the person before it opens.
 */
export function createSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

/**
 * Page addresses whose address carries the result or the code of a
 * connection: the Discord result and the pairing of a machine (PAGE-243).
 * Their documents are never stored and never name their
 * address to anyone, as they did with server rendering (PAGE-235).
 */
export const SENSITIVE_DOCUMENT_PATHS: readonly string[] = [
  "/discord/result",
  "/koppeln",
];

/**
 * Builds the headers of the static app's document for one page address.
 *
 * @param pathname - The page address, decoded; compared as the router
 * matches it, so `/Discord/Result/` counts as `/discord/result`.
 * @returns The security headers; `no-cache` so a new build arrives on the
 * next visit, or `no-store` and `no-referrer` for a sensitive address.
 */
export function createDocumentHeaders(
  pathname: string,
): Record<string, string> {
  if (!SENSITIVE_DOCUMENT_PATHS.includes(normalizePagePath(pathname)))
    return { ...createSecurityHeaders(), "Cache-Control": "no-cache" };
  return {
    ...createSecurityHeaders(),
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
  };
}
