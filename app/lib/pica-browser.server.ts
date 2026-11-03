import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";
import { PicaAdminError } from "@/backend/service/chat/admin/PicaAdminContracts";
import { PicaBrowserSessionStore } from "@/backend/service/chat/browser/PicaBrowserSessionStore";
import { normalizeBrowserOrigins } from "@/backend/service/chat/browser/PicaBrowserTargets";

import type { PagesConfig } from "@/backend/config/PagesConfig";
import type { PicaAdminServiceOptions } from "@/backend/service/chat/admin/PicaAdminService";
import type { PicaBrowserOrigins } from "@/backend/service/chat/browser/PicaBrowserTargets";

/**
 * The local origins the operator browser of Pica may reach (PAGE-181).
 *
 * @param config - The instance configuration, read on every request.
 * @returns This instance on its own port, its public address, and the local
 * services the operator released in `picaBrowserLocalOrigins`.
 *
 * @remarks
 * Only the configuration decides. The address a request arrived under never
 * widens the list, because a client chooses its `Host` header.
 */
export function picaBrowserOrigins(
  config: Pick<PagesConfig, "port" | "mcpHttp" | "picaBrowserLocalOrigins">,
): PicaBrowserOrigins {
  const pages = new Set([
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
  ]);
  const publicUrl = config.mcpHttp?.publicUrl;
  if (publicUrl) pages.add(publicUrl);
  const pageOrigins = normalizeBrowserOrigins([...pages]);
  return {
    pages: pageOrigins,
    services: normalizeBrowserOrigins(
      config.picaBrowserLocalOrigins ?? [],
    ).filter((origin) => !pageOrigins.includes(origin)),
  };
}

/**
 * The operator browser parts the chat services are wired with.
 *
 * @param input - Where sessions are kept, the key that encrypts them, and the configuration.
 * @returns Options for the administrator service.
 */
export function picaBrowserOptions(input: {
  readonly directory: string;
  readonly instanceKey: Buffer;
  readonly config: () => Pick<
    PagesConfig,
    "port" | "mcpHttp" | "picaBrowserLocalOrigins"
  >;
}): PicaAdminServiceOptions {
  return {
    localOrigins: () => picaBrowserOrigins(input.config()),
    browserSessions: new PicaBrowserSessionStore(
      path.join(input.directory, "pica-browser-sessions"),
      input.instanceKey,
    ),
  };
}

const FAILURE_STATUSES: Readonly<Record<string, number>> = {
  ADMIN_REQUIRED: 403,
  OS_RIGHTS_DENIED: 403,
  SESSION_DENIED: 404,
  DOWNLOAD_NOT_FOUND: 404,
  NOT_IN_TAKEOVER: 409,
};

/**
 * Maps a failure of the live interface to a stable code and status; messages and page content never leave.
 *
 * @param error - The failure.
 * @returns A JSON answer that is never cached.
 */
export function picaBrowserFailure(error: unknown): Response {
  const code =
    error instanceof PicaAdminError ? error.message : "BROWSER_FAILED";
  if (!(error instanceof PicaAdminError)) logCaughtError("pica_browser", error);
  return Response.json(
    { ok: false, error: code },
    {
      status: FAILURE_STATUSES[code] ?? (code === "BROWSER_FAILED" ? 500 : 400),
      headers: { "Cache-Control": "no-store" },
    },
  );
}
