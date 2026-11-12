import { normalizePagePath } from "../service-worker/install-service-worker";

/**
 * Content Security Policy of Pages.
 *
 * @remarks
 * React Router renders inline scripts for hydration and React sets inline
 * styles, so both directives allow `'unsafe-inline'`. Everything else is
 * restricted to the own origin. Media may also come from `blob:`: the voice
 * sample of an agent (PAGE-300) is fetched with a `POST` of the own origin
 * and played from a blob URL the page created itself. Only Pages itself may
 * frame a page of Pages: the chat embeds released web content, Pages
 * included, in a sandboxed frame without credentials (PAGE-298), and frames
 * nothing but its own `/chat/embed` document, which carries the policy of
 * the one embedded origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Builds the security headers for HTML responses.
 *
 * @returns Header names with their values.
 *
 * @remarks
 * `Strict-Transport-Security` is not part of this set, because it only makes
 * sense behind TLS and a wrong value locks browsers out of plain HTTP. The
 * own origin may ask for the microphone, for the test recording of the speech
 * recognition (PAGE-273) and for the voice messages of the chat (PAGE-277);
 * the browser still asks the person before it opens. The app is one document
 * for every page, so the permission cannot be limited to one page.
 */
export function createSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
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
