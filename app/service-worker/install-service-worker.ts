/**
 * What the build tells the service worker (PAGE-235).
 *
 * @remarks
 * `vite.config.ts` compiles this module into `build/client/sw.js` and calls
 * {@link installServiceWorker} with the files of the build.
 */
export interface ServiceWorkerBuild {
  /** Changes with every build whose files differ; names the cache. */
  readonly version: string;
  /** Paths of the build's hashed files below `/assets/`. */
  readonly assets: readonly string[];
  /** Path patterns of the server resources; their documents are never the app. */
  readonly forwarded: readonly string[];
  /**
   * Page addresses whose documents are never stored and never shown from a
   * cache, such as pairing; the worker leaves them to the network.
   */
  readonly sensitive: readonly string[];
}

/** The part of an `install` or `activate` event the worker uses. */
interface ExtendableEventLike extends Event {
  waitUntil(work: Promise<unknown>): void;
}

/** The part of a `fetch` event the worker uses. */
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(answer: Promise<Response>): void;
}

/** The part of the service worker's global scope the worker uses. */
export interface ServiceWorkerScope {
  readonly caches: CacheStorage;
  readonly clients: { claim(): Promise<void> };
  readonly location: { readonly origin: string };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: FetchEventLike) => void,
  ): void;
}

const CACHE_PREFIX = "pages-app-";
/** The app's document; every page address shows it. */
const APP_DOCUMENT = "/index.html";
const ASSET_PREFIX = "/assets/";
/** How long a page load waits for the entrance before it opens the kept app. */
const DOCUMENT_TIMEOUT_MS = 4_000;

/** Whether a path matches a React Router path pattern of plain, `:param`, `:param?` and `*` segments. */
function matchesPattern(
  segments: readonly string[],
  pattern: readonly string[],
): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) return segments.length === 0;
  if (head === "*") return true;
  if (head.startsWith(":") && head.endsWith("?"))
    return (
      matchesPattern(segments, rest) ||
      (segments.length > 0 && matchesPattern(segments.slice(1), rest))
    );
  const [segment, ...remaining] = segments;
  if (segment === undefined) return false;
  if (!head.startsWith(":") && head !== segment) return false;
  return matchesPattern(remaining, rest);
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

/**
 * Brings a decoded page address into the form the router matches it in.
 *
 * @param pathname - The decoded path of a page address.
 * @returns The path in lower case, without repeated or trailing slashes.
 *
 * @remarks
 * React Router matches page addresses regardless of case and of trailing
 * slashes, so `/Pair/` opens the pairing page like `/pair`. A list of page
 * addresses has to be compared in this form to cover every address of a page.
 */
export function normalizePagePath(pathname: string): string {
  const path = `/${splitPath(pathname).join("/")}`;
  return path.toLowerCase();
}

/** The decoded path of a URL, or the raw one when it is no valid encoding. */
function decodedPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/** Waits for the entrance, but not longer than {@link DOCUMENT_TIMEOUT_MS}. */
async function fetchInTime(request: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((...settle) => {
    const [, reject] = settle;
    timer = setTimeout(
      () => reject(new TypeError("The entrance did not answer in time.")),
      DOCUMENT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([fetch(request), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps the static app available without the server (PAGE-235).
 *
 * @param scope - The service worker's global scope.
 * @param build - The files and version of the build this worker belongs to.
 *
 * @remarks
 * - On installation the worker keeps the app's document and every hashed
 *   file of its build, then takes over at once; on activation it removes
 *   the files of earlier builds.
 * - A page load asks the entrance first, so a new build's document arrives
 *   on the next visit without clearing any cache. Only when the entrance
 *   cannot be reached is the kept document shown; the app then opens with
 *   what the browser keeps.
 * - Hashed files never change, so the kept copy is used. A file of an
 *   earlier build that is gone fails to load; React Router then loads the
 *   page again, which brings the current build.
 * - Requests to the API are not touched; the app keeps its own answers.
 * - A sensitive page address, such as pairing with its code, is left to the
 *   network: its document is neither kept nor shown from the kept copy.
 */
export function installServiceWorker(
  scope: ServiceWorkerScope,
  build: ServiceWorkerBuild,
): void {
  const cacheName = `${CACHE_PREFIX}${build.version}`;
  const forwarded = build.forwarded.map(splitPath);

  async function install(): Promise<void> {
    const cache = await scope.caches.open(cacheName);
    await cache.addAll(
      [APP_DOCUMENT, ...build.assets].map(
        (path) => new Request(path, { cache: "reload" }),
      ),
    );
    await scope.skipWaiting();
  }

  async function activate(): Promise<void> {
    for (const name of await scope.caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== cacheName)
        await scope.caches.delete(name);
    }
    await scope.clients.claim();
  }

  async function openDocument(request: Request): Promise<Response> {
    try {
      return await fetchInTime(request);
    } catch (error: unknown) {
      const kept = await scope.caches.match(APP_DOCUMENT, { cacheName });
      if (kept) return kept;
      throw error;
    }
  }

  async function openAsset(request: Request): Promise<Response> {
    return (await scope.caches.match(request)) ?? fetch(request);
  }

  function isAppDocument(request: Request, url: URL): boolean {
    if (request.mode !== "navigate") return false;
    if (build.sensitive.includes(normalizePagePath(decodedPath(url))))
      return false;
    const segments = splitPath(url.pathname);
    return !forwarded.some((pattern) => matchesPattern(segments, pattern));
  }

  scope.addEventListener("install", (event) => event.waitUntil(install()));
  scope.addEventListener("activate", (event) => event.waitUntil(activate()));
  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== scope.location.origin) return;
    if (url.pathname.startsWith(ASSET_PREFIX))
      event.respondWith(openAsset(request));
    else if (isAppDocument(request, url))
      event.respondWith(openDocument(request));
  });
}
