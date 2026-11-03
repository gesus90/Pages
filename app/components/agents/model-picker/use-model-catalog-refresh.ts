import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

/** An authorized loader's baseline for conditional catalog refresh, without another catalog payload. */
export interface ModelCatalogRefresh {
  readonly url: string;
  readonly etag: string;
}

/**
 * How current the models of the page are.
 *
 * @remarks
 * `current`: the last check found no change or the page reloaded them;
 * `refreshing`: a check or the reload is running; `failed`: the last check
 * did not reach Pages, so the page still shows the models it loaded before.
 */
export type ModelCatalogStatus = "current" | "refreshing" | "failed";

/** The refresh channel of a page, shared by every model choice on it. */
export interface ModelCatalogRefreshState {
  readonly status: ModelCatalogStatus;
  /** Checks for a newer catalog now, such as when a model choice opens. */
  readonly refresh: () => void;
}

/** Interval of the check while the page is visible; a hidden page is not checked. */
const CHECK_INTERVAL_MS = 15_000;

const IDLE_REFRESH: ModelCatalogRefreshState = {
  status: "current",
  refresh: () => undefined,
};

/** Supplies a page's refresh channel to the model choices inside it. */
export const ModelCatalogRefreshContext =
  createContext<ModelCatalogRefreshState>(IDLE_REFRESH);

/**
 * The refresh channel the surrounding page supplies.
 *
 * @returns The page's channel, or one that never refreshes outside a page that supplies one.
 */
export function useModelCatalogRefreshState(): ModelCatalogRefreshState {
  return useContext(ModelCatalogRefreshContext);
}

/**
 * Keeps the models of a page in step with the shared catalog, without losing unsaved drafts.
 *
 * @remarks
 * Every page with a model choice uses this one channel. The page asks its
 * marker URL whether the authorized catalog projection changed: when the
 * page gains focus, when a model choice opens, and every 15 seconds while
 * it is visible. The marker answers 304 for an unchanged state, so only a
 * real change of models, sources, prices, reasoning levels or access reloads
 * the page's data through React Router. A reload never changes a saved
 * assignment; forms keep their drafts. A failed check keeps the models
 * loaded before and reports `failed` until a later check succeeds.
 *
 * @param input - The page's marker URL and the ETag it loaded; without it nothing is checked.
 * @returns The status for the model choices and a way to check at once.
 */
export function useModelCatalogRefresh(
  input?: ModelCatalogRefresh,
): ModelCatalogRefreshState {
  const { revalidate, state } = useRevalidator();
  const [hasFailed, setFailed] = useState(false);
  const [isChecking, setChecking] = useState(false);
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (state !== "idle") return undefined;
    const controller = new AbortController();
    let isPending = false;
    async function refresh(): Promise<void> {
      if (document.visibilityState !== "visible" || isPending || !input) return;
      isPending = true;
      setChecking(true);
      try {
        const response = await fetch(input.url, {
          cache: "no-store",
          signal: controller.signal,
          headers: { "If-None-Match": input.etag },
        });
        if (controller.signal.aborted) return;
        const hasChanged =
          response.ok || response.status === 401 || response.status === 403;
        setFailed(!hasChanged && response.status !== 304);
        if (hasChanged) void revalidate();
      } catch {
        // A failed reload would unmount drafts; the page keeps its models and says so.
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        isPending = false;
        if (!controller.signal.aborted) setChecking(false);
      }
    }
    refreshRef.current = () => void refresh();
    const timer = window.setInterval(refreshRef.current, CHECK_INTERVAL_MS);
    window.addEventListener("focus", refreshRef.current);
    const listener = refreshRef.current;
    return () => {
      controller.abort();
      setChecking(false);
      window.clearInterval(timer);
      window.removeEventListener("focus", listener);
    };
  }, [input, revalidate, state]);
  let status: ModelCatalogStatus = hasFailed ? "failed" : "current";
  if (isChecking || state === "loading") status = "refreshing";
  return { status, refresh: () => refreshRef.current() };
}
