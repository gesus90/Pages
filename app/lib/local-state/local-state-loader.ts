import { isRouteErrorResponse } from "react-router";

import { whenLocalStateAudienceSettled } from "./local-state-audience";
import { localState } from "./local-state-store";

import type { LocalStateKind } from "./local-state-store";

/** Answers of a proxy or of the server itself that mean the backend cannot serve now. */
const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Answers that take an account's access to the route away. */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/** Why a route shows a kept answer instead of a current one. */
export interface LocalStateMark {
  /** `stale` while the server's answer is pending, `offline` when the backend is unreachable. */
  readonly state: "stale" | "offline";
  /** When the browser received the kept answer, in milliseconds since the epoch. */
  readonly savedAt: number;
}

/** Route data that may come from the browser's local state. */
export type WithLocalState<T> = T & { readonly localState?: LocalStateMark };

const openRoutes = new Map<string, number>();

/**
 * The key of a route's answers: path and query, as the address shows them.
 *
 * @param url - The address of the route.
 */
export function localStateRoute(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/**
 * Marks a route as shown, so loading it again revalidates instead of reopening it.
 *
 * @param route - The key of the shown route.
 * @returns Removes the mark when the route is no longer shown.
 */
export function markLocalStateRouteOpen(route: string): () => void {
  openRoutes.set(route, (openRoutes.get(route) ?? 0) + 1);
  return () => {
    const count = (openRoutes.get(route) ?? 1) - 1;
    if (count > 0) openRoutes.set(route, count);
    else openRoutes.delete(route);
  };
}

/** The status of a failed route load, from the server loader or from a route's endpoint. */
function failedStatus(error: unknown): number | null {
  if (isRouteErrorResponse(error) || error instanceof Response)
    return error.status;
  return null;
}

/**
 * Whether a failed route load means the backend could not be reached.
 *
 * @param error - What the load threw.
 */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return UNREACHABLE_STATUSES.has(failedStatus(error) ?? 0);
}

/** Whether a failed route load is the server refusing this account or ending its session. */
function isRefusal(error: unknown): boolean {
  if (error instanceof Response && error.headers.has("Location")) return true;
  return REFUSED_STATUSES.has(failedStatus(error) ?? 0);
}

/** The kept answer of a route, if it still applies to the signed-in context. */
async function readKept<T>(
  route: string,
  kind: LocalStateKind<T>,
): Promise<{ readonly payload: T; readonly savedAt: number } | null> {
  // A document opened without the server learns its account in the root loader.
  await localState.whenClaimed();
  const kept = await localState.read(route, kind);
  if (!kept) return null;
  if (kind.isCurrent && !kind.isCurrent(kept.payload)) {
    await localState.remove(route);
    return null;
  }
  return kept;
}

/**
 * Loads a route from its kept answer first and from the server otherwise.
 *
 * @remarks
 * Opening a route shows the kept answer of the signed-in account at once,
 * marked `stale`; the route then asks the server again while it is shown.
 * Loading a shown route again, after an action or by its own refresh, reads
 * the server. When the backend is unreachable the kept answer is shown,
 * marked `offline`. A kept answer that no longer applies, such as one given
 * under other rights, is removed instead. A refusal or a redirect, such as
 * to the sign-in page, removes the kept answer and is passed on. Nothing is
 * kept here: the route keeps the answers it has shown, so a cancelled load
 * leaves no trace.
 *
 * @param route - The key of the route's answers, see {@link localStateRoute}.
 * @param kind - The stored form of the route's answers.
 * @param serverLoader - Reads the route from the server.
 */
export async function loadLocalFirst<T extends object>(
  route: string,
  kind: LocalStateKind<T>,
  serverLoader: () => Promise<T>,
): Promise<WithLocalState<T>> {
  // A kept answer applies only under the rights the shell's loader names.
  await whenLocalStateAudienceSettled();
  if (!openRoutes.has(route)) {
    const kept = await readKept(route, kind);
    if (kept)
      return {
        ...kept.payload,
        localState: { state: "stale", savedAt: kept.savedAt },
      };
  }
  try {
    return await serverLoader();
  } catch (error: unknown) {
    if (isUnreachable(error)) {
      const kept = await readKept(route, kind);
      if (kept)
        return {
          ...kept.payload,
          localState: { state: "offline", savedAt: kept.savedAt },
        };
    } else if (isRefusal(error)) await localState.remove(route);
    throw error;
  }
}

/**
 * Loads a route from the server and from its kept answer only when the backend is unreachable.
 *
 * @remarks
 * For the frames of the static app, which name the account and its rights
 * and must not open from an older answer while the server can say better.
 * A refusal or a redirect removes the kept answer and is passed on.
 *
 * @param route - The key of the kept answer.
 * @param kind - The stored form of the answer.
 * @param serverLoader - Reads the route from the server.
 */
export async function loadServerFirst<T extends object>(
  route: string,
  kind: LocalStateKind<T>,
  serverLoader: () => Promise<T>,
): Promise<WithLocalState<T>> {
  try {
    return await serverLoader();
  } catch (error: unknown) {
    if (isUnreachable(error)) {
      const kept = await readKept(route, kind);
      if (kept)
        return {
          ...kept.payload,
          localState: { state: "offline", savedAt: kept.savedAt },
        };
    } else if (isRefusal(error)) await localState.remove(route);
    throw error;
  }
}
