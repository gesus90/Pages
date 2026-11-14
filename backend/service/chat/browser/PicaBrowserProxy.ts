import { PicaAdminError } from "../admin/PicaAdminContracts";
import {
  requireWriteApproval,
  resolveBrowserTarget,
} from "./PicaBrowserTargets";

import type { BrowserContext, Request, Route } from "playwright-core";
import type {
  PicaBrowserOrigins,
  PicaBrowserTarget,
} from "./PicaBrowserTargets";
import type {
  PicaBrowserTransport,
  PicaBrowserUpstreamResponse,
} from "./PicaBrowserTransport";

/** A file the page asked the browser to download; Pages keeps it on the server. */
export interface PicaBrowserCapturedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly url: string;
}

/** What the proxy needs from the browser it serves. */
export interface PicaBrowserProxyHost {
  readonly signal: AbortSignal;
  readonly hasOwnAccount?: boolean;
  readonly origins: () => PicaBrowserOrigins;
  readonly areWritesApproved: () => boolean;
  /** Rechecks the administrator right; throws when it ended. */
  readonly authorize: () => Promise<void>;
  /** Reports something the model should know about the next observation. */
  readonly note: (message: string) => void;
  readonly capture: (file: PicaBrowserCapturedFile) => void;
}

/** Bounds of the network use of one browser. */
export const PICA_BROWSER_NETWORK_LIMITS = {
  requests: 4000,
  totalBytes: 400 * 1024 * 1024,
  responseBytes: 25 * 1024 * 1024,
  requestMilliseconds: 25_000,
} as const;

const RENDERABLE_TYPES: ReadonlySet<string> = new Set([
  "application/xhtml+xml",
  "application/xml",
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/wasm",
  "application/manifest+json",
  "application/ld+json",
]);

function singleHeader(
  headers: PicaBrowserUpstreamResponse["headers"],
  name: string,
): string {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function fileNameOf(disposition: string, url: URL): string {
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/u.exec(
    disposition,
  );
  const quoted = /filename\s*=\s*"([^"]+)"/u.exec(disposition);
  const bare = /filename\s*=\s*([^;]+)/u.exec(disposition);
  let candidate = quoted?.[1] ?? bare?.[1] ?? "";
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded[1]);
    } catch {
      candidate = encoded[1];
    }
  }
  if (!candidate.trim()) candidate = url.pathname.split("/").pop() ?? "";
  const cleaned = candidate.replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  return (cleaned || "download").slice(0, 100);
}

/**
 * Decides whether an answer is a file download instead of page content.
 *
 * @param request - The browser request the answer belongs to.
 * @param response - The decoded answer.
 * @returns The captured file, or `null` when the browser renders the answer.
 */
export function detectDownload(
  request: Request,
  response: PicaBrowserUpstreamResponse,
): PicaBrowserCapturedFile | null {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.status === 204
  )
    return null;
  const disposition = singleHeader(response.headers, "content-disposition");
  const type = singleHeader(response.headers, "content-type")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const isAttachment = /^\s*attachment/iu.test(disposition);
  const isRenderable =
    type === "" ||
    type.startsWith("text/") ||
    type.startsWith("image/") ||
    RENDERABLE_TYPES.has(type);
  if (!isAttachment && !(request.isNavigationRequest() && !isRenderable))
    return null;
  const url = new URL(request.url());
  return {
    fileName: fileNameOf(disposition, url),
    contentType: type || "application/octet-stream",
    bytes: response.body,
    url: `${url.origin}${url.pathname}`,
  };
}

function joinHeaders(
  headers: PicaBrowserUpstreamResponse["headers"],
): Record<string, string> {
  const joined: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers))
    joined[name] = Array.isArray(value)
      ? value.join(name === "set-cookie" ? "\n" : ", ")
      : value;
  return joined;
}

/** Never forwards the Pages login cookie to a released service on another port or an external site. */
export function browserRequestCookies(
  cookies: readonly Pick<
    Awaited<ReturnType<BrowserContext["cookies"]>>[number],
    "name" | "value"
  >[],
  kind: PicaBrowserTarget["kind"],
): string {
  return cookies
    .filter((entry) => entry.name !== "pages_session" || kind === "pages")
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");
}

function failureLabel(error: unknown): string {
  if (error instanceof PicaAdminError) return error.message;
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "NETWORK_ERROR";
}

/**
 * Serves every request of one operator browser from the server.
 *
 * @remarks
 * The browser runs without a network interface. This class answers its
 * requests: it checks the destination against the target policy, adds the
 * cookies of this browser only, sends the request to the pinned address and
 * hands the answer back. A refused request ends as a blocked request inside
 * the browser and as a note for the next observation.
 */
export class PicaBrowserProxy {
  private readonly host: PicaBrowserProxyHost;
  private readonly context: BrowserContext;
  private readonly transport: PicaBrowserTransport;
  private requests = 0;
  private bytes = 0;
  private lastRefusal: string | null = null;

  /**
   * Creates the proxy of one browser context.
   *
   * @param host - The session callbacks.
   * @param context - The isolated browser context whose cookies are used.
   * @param transport - The pinned network access of the browser.
   */
  public constructor(
    host: PicaBrowserProxyHost,
    context: BrowserContext,
    transport: PicaBrowserTransport,
  ) {
    this.host = host;
    this.context = context;
    this.transport = transport;
  }

  /** Why the last request was refused; cleared when read. */
  public takeRefusal(): string | null {
    const refusal = this.lastRefusal;
    this.lastRefusal = null;
    return refusal;
  }

  /** Answers one intercepted request. */
  public async handle(route: Route): Promise<void> {
    const request = route.request();
    try {
      this.host.signal.throwIfAborted();
      this.requests += 1;
      if (this.requests > PICA_BROWSER_NETWORK_LIMITS.requests)
        throw new PicaAdminError("RESOURCE_LIMIT");
      if (request.isNavigationRequest() || request.method() !== "GET")
        await this.host.authorize();
      const answer = await this.forward(request);
      this.bytes += answer.body.length;
      if (this.bytes > PICA_BROWSER_NETWORK_LIMITS.totalBytes)
        throw new PicaAdminError("RESOURCE_LIMIT");
      const file = detectDownload(request, answer);
      if (file) {
        this.host.capture(file);
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({
        status: answer.status,
        headers: joinHeaders(answer.headers),
        body: answer.body,
      });
    } catch (error: unknown) {
      await this.refuse(route, error);
    }
  }

  private async forward(
    request: Request,
  ): Promise<PicaBrowserUpstreamResponse> {
    const method = request.method();
    const target = await resolveBrowserTarget(
      request.url(),
      this.host.origins(),
    );
    requireWriteApproval(
      target,
      method,
      this.host.areWritesApproved(),
      this.host.hasOwnAccount === true,
    );
    this.requireLocalInitiator(request, target);
    const cookies = await this.context.cookies(target.url.href);
    return this.transport.send({
      target,
      method,
      headers: await request.allHeaders(),
      cookie: browserRequestCookies(cookies, target.kind),
      body: request.postDataBuffer(),
      signal: this.host.signal,
    });
  }

  /**
   * A page from the public internet may not reach local origins behind the
   * browser's back; only a navigation, which the person or Pica chose, may.
   */
  private requireLocalInitiator(
    request: Request,
    target: PicaBrowserTarget,
  ): void {
    if (target.kind === "public" || request.isNavigationRequest()) return;
    const origins = this.host.origins();
    let initiator: string;
    try {
      initiator = new URL(request.frame().page().url()).origin;
    } catch {
      throw new PicaAdminError("URL_DENIED");
    }
    if (
      !origins.pages.includes(initiator) &&
      !origins.services.includes(initiator)
    )
      throw new PicaAdminError("URL_DENIED");
  }

  private async refuse(route: Route, error: unknown): Promise<void> {
    const request = route.request();
    const label = failureLabel(error);
    if (request.isNavigationRequest() || error instanceof PicaAdminError) {
      this.lastRefusal = label;
      const target = new URL(request.url());
      this.host.note(`Request to ${target.host} was refused: ${label}.`);
    }
    await route
      .abort(error instanceof PicaAdminError ? "blockedbyclient" : "failed")
      .catch(() => undefined);
  }
}
