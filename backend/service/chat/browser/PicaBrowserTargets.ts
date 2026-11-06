import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import {
  publicBrowserUrl,
  resolvePublicAddress,
} from "../admin/PicaBrowserNetwork";

/**
 * The origins the operator browser may reach besides the public internet.
 *
 * @remarks
 * `pages` is this Pages instance; `services` are local services the operator
 * of the server released in the configuration. Both are exact origins, so a
 * released port never widens to another one.
 */
export interface PicaBrowserOrigins {
  readonly pages: readonly string[];
  readonly services: readonly string[];
}

/** Where one request goes, and the address it is pinned to. */
export interface PicaBrowserTarget {
  readonly url: URL;
  readonly kind: "public" | "pages" | "service";
  readonly address: string;
}

/** Paths of Pica's own control surfaces; a browser driven by Pica never reaches them. */
const PICA_CONTROL_PATHS = [
  "/chat-api",
  "/chat/",
  "/api/v1/pica-bridge",
  "/api/v1/plan-bridge",
  "/pica-tools-api",
] as const;

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Normalizes configured origins; an entry that is no http(s) origin is dropped.
 *
 * @param entries - Origins or URLs from the configuration.
 * @returns Unique origins such as `http://127.0.0.1:3100`.
 */
export function normalizeBrowserOrigins(
  entries: readonly string[],
): readonly string[] {
  const origins = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      if (url.protocol === "http:" || url.protocol === "https:")
        origins.add(url.origin);
    } catch {
      // A malformed entry grants nothing.
      continue;
    }
  }
  return [...origins];
}

async function localAddress(hostname: string): Promise<string> {
  if (isIP(hostname) === 4) return hostname;
  try {
    const answer = await lookup(hostname, { family: 4 });
    return answer.address;
  } catch {
    throw new PicaAdminError("URL_DENIED");
  }
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PicaAdminError("URL_DENIED");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  )
    throw new PicaAdminError("URL_DENIED");
  return url;
}

/**
 * Decides where a request may go and pins its destination address.
 *
 * @param raw - The absolute URL of the request.
 * @param origins - The released local origins.
 * @returns The target with the address the connection must use.
 * @throws {PicaAdminError} `URL_DENIED` for every other destination, including
 * private addresses, other ports, redirects into Pages and Pica's own control paths.
 */
export async function resolveBrowserTarget(
  raw: string,
  origins: PicaBrowserOrigins,
): Promise<PicaBrowserTarget> {
  const url = parseUrl(raw);
  const isPages = origins.pages.includes(url.origin);
  if (isPages || origins.services.includes(url.origin)) {
    const path = url.pathname;
    if (
      isPages &&
      PICA_CONTROL_PATHS.some(
        (entry) => path === entry || path.startsWith(entry),
      )
    )
      throw new PicaAdminError("URL_DENIED");
    return {
      url,
      kind: isPages ? "pages" : "service",
      address: await localAddress(url.hostname),
    };
  }
  const checked = publicBrowserUrl(url.href);
  return {
    url: checked,
    kind: "public",
    address: await resolvePublicAddress(checked.hostname),
  };
}

/**
 * Refuses a change to a local service until the administrator allowed it for this browser.
 *
 * @param target - The checked destination.
 * @param method - The HTTP method of the request.
 * @param areWritesApproved - Whether the administrator approved changes to local services.
 * @throws {PicaAdminError} `LOCAL_WRITE_NOT_APPROVED`.
 */
export function requireWriteApproval(
  target: PicaBrowserTarget,
  method: string,
  areWritesApproved: boolean,
): void {
  if (
    target.kind !== "public" &&
    !SAFE_METHODS.has(method.toUpperCase()) &&
    !areWritesApproved
  )
    throw new PicaAdminError("LOCAL_WRITE_NOT_APPROVED");
}
