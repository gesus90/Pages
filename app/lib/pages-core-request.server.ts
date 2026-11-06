import { timingSafeEqual } from "node:crypto";

import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import {
  PAGES_CORE_CONTRACT_VERSION,
  PAGES_CORE_LIMITS,
} from "@/definition/PagesCoreContract";

/** Headers of every answer to `pages-core`; nothing of it is kept. */
export const PAGES_CORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Answers `pages-core` without a decision.
 *
 * @param status - The HTTP status, such as `400` or `503`.
 * @returns An answer that names only the contract version.
 */
export function refusePagesCore(status: number): Response {
  return Response.json(
    { contract: PAGES_CORE_CONTRACT_VERSION },
    { status, headers: PAGES_CORE_HEADERS },
  );
}

function isCoreAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

/**
 * Admits a request of `pages-core` to an `/api/core/` endpoint.
 *
 * @param request - The request on the API's loopback port.
 * @returns The shared secret when the request carries it, otherwise the
 * refusal to answer: `404` without `pagesCoreSecret` in the configuration,
 * `401` for a missing or wrong secret, `405` for another method than `POST`.
 *
 * @remarks
 * The secret is compared in constant time. `pages-ingress` never forwards
 * `/api/core/`, so browsers cannot reach these endpoints.
 */
export async function admitPagesCore(
  request: Request,
): Promise<{ readonly secret: string } | Response> {
  const secret = (await getPagesRuntime()).getConfig().pagesCoreSecret;
  if (secret === undefined) return refusePagesCore(404);
  if (!isCoreAuthorized(request.headers.get("Authorization"), secret))
    return refusePagesCore(401);
  if (request.method !== "POST") return refusePagesCore(405);
  return { secret };
}

/**
 * Answers a read of an `/api/core/` endpoint, which accepts `POST` only.
 *
 * @returns `404` without `pagesCoreSecret` in the configuration, otherwise `405`.
 */
export async function refusePagesCoreRead(): Promise<Response> {
  const secret = (await getPagesRuntime()).getConfig().pagesCoreSecret;
  return refusePagesCore(secret === undefined ? 404 : 405);
}

/**
 * Reads the JSON body of a request of `pages-core`.
 *
 * @param request - The admitted request.
 * @returns The parsed body, or `undefined` when it is larger than the
 * contract's limit or no JSON; a larger declared body is refused unread.
 */
export async function readPagesCoreJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isNaN(declared) || declared > PAGES_CORE_LIMITS.bodyBytes)
    return undefined;
  const text = await request.text();
  if (text.length > PAGES_CORE_LIMITS.bodyBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // An unreadable body is answered like any other invalid request.
    return undefined;
  }
}
