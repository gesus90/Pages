import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  logCaughtError,
  logEvent,
  logFileProbeError,
} from "@/backend/logging/Logger";

import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** Build output below `/assets/` carries a content hash in its file name. */
const HASHED_ASSET_PREFIX = "/assets/";
const HASHED_ASSET_CACHE = "public, max-age=31536000, immutable";
const OTHER_ASSET_CACHE = "public, max-age=3600";
/**
 * Files of the static app that name the current build (PAGE-235): a browser
 * asks again before using a kept copy, so it picks up a new build at once.
 */
const BUILD_ENTRY_FILES: ReadonlySet<string> = new Set(["/sw.js"]);
const BUILD_ENTRY_CACHE = "no-cache";
/** The app's document is answered with its security headers by `AppDocument`. */
const APP_DOCUMENT_PATH = "/index.html";

function cacheControl(pathname: string): string {
  if (BUILD_ENTRY_FILES.has(pathname)) return BUILD_ENTRY_CACHE;
  return pathname.startsWith(HASHED_ASSET_PREFIX)
    ? HASHED_ASSET_CACHE
    : OTHER_ASSET_CACHE;
}

function decodePathname(requestUrl: string): string | null {
  try {
    const pathname = decodeURIComponent(
      new URL(requestUrl, "http://pages.invalid").pathname,
    );

    return pathname.includes("\0") ? null : pathname;
  } catch (caughtError: unknown) {
    logCaughtError("StaticAssets", caughtError);
    return null;
  }
}

/**
 * Maps a request path to a file below the client build directory.
 *
 * @returns The file path, or `null` for the root and for hidden names.
 *
 * @remarks
 * Every segment starting with a dot is refused, which includes `.` and
 * `..`, so the decoded path can never leave the directory.
 */
function resolveAssetPath(root: string, pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (
    segments.length === 0 ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    return null;
  }

  return path.resolve(root, ...segments);
}

async function readFileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await stat(filePath);

    return stats.isFile() ? stats.size : null;
  } catch (caughtError: unknown) {
    logFileProbeError("StaticAssets", caughtError);

    return null;
  }
}

/**
 * Answers a request with a file of the client build when one matches.
 *
 * @param request - Incoming request.
 * @param response - Response to write the file to.
 * @param clientDirectory - Absolute path of the client build output.
 * @returns Whether a file was sent; otherwise the request is left untouched
 * for the application.
 *
 * @remarks
 * Only `GET` and `HEAD` requests for regular files below the directory are
 * served. Encoded `..`, absolute segments, and hidden files never match.
 */
export async function serveStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
  clientDirectory: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const pathname = decodePathname(request.url ?? "/");

  if (pathname === null || pathname === APP_DOCUMENT_PATH) {
    return false;
  }

  const filePath = resolveAssetPath(path.resolve(clientDirectory), pathname);
  const size = filePath === null ? null : await readFileSize(filePath);

  if (filePath === null || size === null) {
    return false;
  }

  response.writeHead(200, {
    "Cache-Control": cacheControl(pathname),
    "Content-Length": size,
    "Content-Type":
      CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
      FALLBACK_CONTENT_TYPE,
    "X-Content-Type-Options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
  } else {
    // A file removed after the size check ends the response instead of the process.
    createReadStream(filePath)
      .on("error", (error: Error) => {
        logEvent({
          level: "error",
          event: "http.asset.failed",
          component: "StaticAssets",
          message: "Static asset stream failed",
          error,
        });
        response.destroy();
      })
      .pipe(response);
  }

  return true;
}

/**
 * Answers a request for a hashed file that the build does not contain with `404`.
 *
 * @param request - A request no file of the build answered.
 * @param response - Response to write the refusal to.
 * @returns Whether the request named a hashed file and was refused.
 *
 * @remarks
 * A browser that still runs an earlier build may ask for one of its files
 * after an update (PAGE-235). It must fail at once instead of receiving the
 * app's document, so React Router loads the page again with the current
 * build. Never cached, because the same name may come with a later build.
 */
export function refuseMissingAsset(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const pathname = decodePathname(request.url ?? "/");
  if (pathname === null || !pathname.startsWith(HASHED_ASSET_PREFIX))
    return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  response.writeHead(404, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : "Not Found");
  return true;
}
