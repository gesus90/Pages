import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDocumentHeaders } from "@/app/lib/security-headers";
import { logFileProbeError } from "@/backend/logging/Logger";

import type { ServerResponse } from "node:http";

/**
 * Reads the path of a request target as the browser sent it, still encoded.
 *
 * @param requestUrl - The request target, usually in origin form (`/pair?code=…`).
 * @returns The path, `/` without a target.
 *
 * @remarks
 * Resolved against a base, a target such as `//pair` would be read as an
 * address on another host and lose its path; the browser and the router
 * still see `//pair` and open the pairing page.
 */
export function requestTargetPath(requestUrl: string | undefined): string {
  const target = requestUrl ?? "/";
  return new URL(
    target.startsWith("/") ? `http://pages.invalid${target}` : target,
  ).pathname;
}

/** The static app's document; every page address answers with it (PAGE-235). */
export const APP_DOCUMENT_FILE = "index.html";

/**
 * Answers a page address with the static app's document.
 *
 * @param request - Method (`GET` or `HEAD`) and decoded path of the page address.
 * @param response - The response to write.
 * @param clientDirectory - Absolute path of the static app's files.
 * @returns Whether the document existed; otherwise nothing was written.
 *
 * @remarks
 * The document is read on every request and never kept by a cache without
 * asking again (`no-cache`), so a browser loads a new build's document,
 * and with it the new hashed files, on its next visit. It carries the
 * security headers every HTML page of Pages carries; a sensitive address is
 * never stored and never sent as referrer (see `createDocumentHeaders`).
 */
export async function serveAppDocument(
  request: { readonly method: string; readonly pathname: string },
  response: ServerResponse,
  clientDirectory: string,
): Promise<boolean> {
  let document: Buffer;
  try {
    document = await readFile(path.join(clientDirectory, APP_DOCUMENT_FILE));
  } catch (error: unknown) {
    // A directory without the static app: the caller answers instead.
    logFileProbeError("AppDocument", error);
    return false;
  }
  response.writeHead(200, {
    ...createDocumentHeaders(request.pathname),
    "Content-Length": document.length,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(request.method === "HEAD" ? undefined : document);
  return true;
}
