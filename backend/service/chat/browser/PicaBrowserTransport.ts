import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";

import { PicaAdminError } from "../admin/PicaAdminContracts";

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { PicaBrowserTarget } from "./PicaBrowserTargets";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);

/** Request headers Pages sets itself or must never take from the page. */
const OWN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
  "cookie",
  "accept-encoding",
  "expect",
]);

/** Response headers that describe the hop to the server, not the answer for the page. */
const HOP_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "alt-svc",
  "strict-transport-security",
  "proxy-authenticate",
  "upgrade",
]);

/** One request the page made, ready to go to the pinned address. */
export interface PicaBrowserUpstreamRequest {
  readonly target: PicaBrowserTarget;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The cookie header Pages built from the cookies of this browser. */
  readonly cookie: string;
  readonly body: Buffer | null;
  readonly signal: AbortSignal;
}

/** The answer of the server, decoded and without hop headers. */
export interface PicaBrowserUpstreamResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly body: Buffer;
}

/** Size and time bounds of one browser's network use. */
export interface PicaBrowserTransportLimits {
  readonly responseBytes: number;
  readonly requestMilliseconds: number;
}

async function decode(
  body: Buffer,
  encoding: string,
  maximumBytes: number,
): Promise<Buffer> {
  // A compressed answer may not grow past the limit either.
  const options = { maxOutputLength: maximumBytes };
  switch (encoding.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return gunzipAsync(body, options);
    case "deflate":
      return inflateAsync(body, options);
    case "br":
      return brotliAsync(body, options);
    default:
      return body;
  }
}

function responseHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const kept: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_RESPONSE_HEADERS.has(name)) continue;
    kept[name] = value;
  }
  return kept;
}

function readBody(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBytes)
        response.destroy(new PicaAdminError("RESULT_TOO_LARGE"));
      else chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Sends the requests of one operator browser to their pinned addresses.
 *
 * @remarks
 * The browser has no network of its own. Every request, redirect target and
 * subresource passes the target policy first and arrives here with the address
 * the policy resolved, so a second DNS answer can never redirect it. Redirects
 * are returned to the browser, which asks again and so passes the policy again.
 */
export class PicaBrowserTransport {
  private readonly limits: PicaBrowserTransportLimits;
  private readonly httpAgent = new HttpAgent({
    keepAlive: true,
    maxSockets: 8,
  });
  private readonly httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxSockets: 8,
  });

  /**
   * Creates the transport of one browser.
   *
   * @param limits - The response size and per-request time of the browser.
   */
  public constructor(limits: PicaBrowserTransportLimits) {
    this.limits = limits;
  }

  /** Sends one request and returns the decoded answer. */
  public async send(
    input: PicaBrowserUpstreamRequest,
  ): Promise<PicaBrowserUpstreamResponse> {
    const { url } = input.target;
    const isSecure = url.protocol === "https:";
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers))
      if (!OWN_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    headers.Host = url.host;
    headers["Accept-Encoding"] = "gzip, deflate, br";
    if (input.cookie) headers.Cookie = input.cookie;
    if (input.body) headers["Content-Length"] = String(input.body.length);
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.limits.requestMilliseconds),
    ]);
    const send = isSecure ? httpsRequest : httpRequest;
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const connection = send(
        {
          method: input.method,
          hostname: input.target.address,
          port: url.port || (isSecure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          headers,
          agent: isSecure ? this.httpsAgent : this.httpAgent,
          signal,
          ...(isSecure ? { servername: url.hostname } : {}),
        },
        resolve,
      );
      connection.on("error", reject);
      connection.end(input.body ?? undefined);
    });
    const raw = await readBody(response, this.limits.responseBytes);
    const encoding = response.headers["content-encoding"] ?? "";
    return {
      status: response.statusCode ?? 502,
      headers: responseHeaders(response.headers),
      body: await decode(raw, encoding, this.limits.responseBytes),
    };
  }

  /** Drops idle connections; later requests fail with the closed browser. */
  public close(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}
