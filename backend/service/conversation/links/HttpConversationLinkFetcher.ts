import { lookup as resolveHostName } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP } from "node:net";

import { logCaughtError } from "@/backend/logging/Logger";

import { readLinkPreview } from "./ConversationLinkPreviewHtml";

import type {
  ConversationLinkFetcher,
  ConversationLinkImage,
  ConversationLinkImageMimeType,
  ConversationLinkPreview,
} from "./ConversationLinkFetcher";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

const MAXIMUM_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MILLISECONDS = 5000;
const DEFAULT_MAXIMUM_BYTES = 1_000_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
const HTML_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
]);
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const DENIED_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  // Includes the broadcast address 255.255.255.255.
  ["240.0.0.0", 4],
] as const)
  DENIED_IPV4.addSubnet(network, prefix, "ipv4");

const DENIED_IPV6 = new BlockList();
DENIED_IPV6.addAddress("::", "ipv6");
DENIED_IPV6.addAddress("::1", "ipv6");
for (const [network, prefix] of [
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const)
  DENIED_IPV6.addSubnet(network, prefix, "ipv6");

/** One answer of a host name lookup. */
export interface ConversationLinkAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** One request of a fetch: a validated URL and the checked address the connection must go to. */
export interface ConversationLinkRequest {
  /** Address of this hop; http(s) without credentials. */
  readonly url: URL;
  /** The checked IP address to connect to, instead of resolving the host name again. */
  readonly address: string;
  readonly family: 4 | 6;
  /** Aborts when the time limit of the whole fetch is reached. */
  readonly signal: AbortSignal;
  /** Media types whose body is read when the status is 200; lower case, without parameters. */
  readonly acceptedTypes: ReadonlySet<string>;
  /** Number of body bytes after which reading stops. */
  readonly maximumBytes: number;
}

/** The answer to one request; redirects are not followed by the request itself. */
export interface ConversationLinkResponse {
  readonly status: number;
  /** The `Content-Type` header; `""` when missing. */
  readonly contentType: string;
  /** The `Location` header; `null` when missing. */
  readonly location: string | null;
  /** At most `maximumBytes` of the body; empty when the body was not read. */
  readonly body: Uint8Array;
  /** Whether the body was longer than `maximumBytes`. */
  readonly isTruncated: boolean;
}

/** Replaceable parts of {@link HttpConversationLinkFetcher}, for tests. */
export interface HttpConversationLinkFetcherOptions {
  /**
   * Resolves a host name. Every answer is checked, and the connection goes
   * to the first one. Default: `node:dns` `lookup` with `all: true`.
   */
  readonly lookup?: (
    hostname: string,
  ) => Promise<readonly ConversationLinkAddress[]>;
  /** Sends one request to the pinned address. Default: `node:http` / `node:https`. */
  readonly request?: (
    input: ConversationLinkRequest,
  ) => Promise<ConversationLinkResponse>;
  /** Decides whether an IP address may be contacted. Default: {@link isPublicAddress}. */
  readonly isPublicAddress?: (address: string) => boolean;
  /** Time limit of a whole fetch including redirects. Default: 5,000. */
  readonly timeoutMilliseconds?: number;
  /** Limit of the body size. Default: 1,000,000. */
  readonly maximumBytes?: number;
}

interface LoadedResponse {
  readonly response: ConversationLinkResponse;
  readonly finalUrl: URL;
}

function readIpv6Groups(part: string): number[] {
  if (part === "") return [];
  return part.split(":").flatMap((piece) => {
    if (!piece.includes(".")) return [Number.parseInt(piece, 16)];
    const [first, second, third, fourth] = piece.split(".").map(Number);
    return [first * 256 + second, third * 256 + fourth];
  });
}

/** Expands a valid IPv6 literal to its eight 16-bit groups. */
function expandIpv6(address: string): number[] {
  const [head, tail] = address.split("::");
  const leading = readIpv6Groups(head);
  if (tail === undefined) return leading;
  const trailing = readIpv6Groups(tail);
  const gap = Math.max(0, 8 - leading.length - trailing.length);
  return [...leading, ...new Array<number>(gap).fill(0), ...trailing];
}

/** Returns the IPv4 address inside an IPv4-mapped (`::ffff:0:0/96`) or NAT64 (`64:ff9b::/96`) address. */
function embeddedIpv4(groups: readonly number[]): string | null {
  const prefix = groups.slice(0, 6).join(":");
  if (prefix !== "0:0:0:0:0:65535" && prefix !== "100:65435:0:0:0:0")
    return null;
  const [high, low] = groups.slice(6);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/**
 * Decides whether an IP address belongs to the public internet.
 *
 * @remarks
 * Loopback, private, link-local, carrier-grade NAT, documentation,
 * multicast and reserved ranges are refused. IPv4-mapped and NAT64
 * addresses are judged by the IPv4 address they carry.
 *
 * @param address - IPv4 or IPv6 literal without brackets.
 * @returns `false` for refused ranges and for anything that is not an IP address.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !DENIED_IPV4.check(address, "ipv4");
  if (version !== 6) return false;
  // A zone index only names the local interface of a link-local address.
  const literal = address.split("%")[0];
  const groups = expandIpv6(literal);
  if (groups.length !== 8) return false;
  const embedded = embeddedIpv4(groups);
  if (embedded !== null) return !DENIED_IPV4.check(embedded, "ipv4");
  return !DENIED_IPV6.check(literal, "ipv6");
}

/** Reads an http(s) address without credentials; `null` for everything else. */
function readPublicUrl(text: string, base?: URL): URL | null {
  if (!URL.canParse(text, base)) return null;
  const url = new URL(text, base);
  const isWeb = url.protocol === "http:" || url.protocol === "https:";
  const hasCredentials = url.username !== "" || url.password !== "";
  return isWeb && !hasCredentials ? url : null;
}

function mediaType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function isImageType(type: string): type is ConversationLinkImageMimeType {
  return IMAGE_TYPES.has(type);
}

/** Decodes with the charset of the header when the runtime knows it, otherwise as UTF-8. */
function decodeHtml(body: Uint8Array, contentType: string): string {
  const label = /charset="?([\w-]{1,40})/iu.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

/** Settles like `work`, but rejects as soon as the time limit aborts the fetch. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new Error("The link fetch reached its time limit."));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Tells failures of the foreign side (DNS, connection, TLS, broken HTTP)
 * from defects of this server; only the latter are worth a log entry.
 */
function isRemoteFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = typeof error.code === "string" ? error.code : "";
  return (
    /^E(?!RR_)[A-Z0-9_]+$/u.test(code) ||
    /^(?:HPE_|ERR_TLS_|ERR_SSL_)/u.test(code) ||
    code.includes("CERT") ||
    code.includes("SIGNATURE")
  );
}

async function resolveWithDns(
  hostname: string,
): Promise<readonly ConversationLinkAddress[]> {
  const answers = await resolveHostName(hostname, { all: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
}

/** Answers every lookup of the connection with the checked address, so DNS rebinding cannot swap it. */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (hostname, options, callback) => {
    if (options.all === true) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function openPinnedResponse(
  input: ConversationLinkRequest,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const send = input.url.protocol === "https:" ? requestHttps : requestHttp;
    // The URL keeps the host name, so the Host header and the TLS server name stay the name.
    const outgoing = send(
      input.url,
      {
        method: "GET",
        agent: false,
        signal: input.signal,
        lookup: pinnedLookup(input.address, input.family),
        headers: {
          Accept: [...input.acceptedTypes].join(", "),
          "User-Agent": "Pages-LinkPreview/1.0",
        },
      },
      resolve,
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function readLimitedBody(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<{ body: Uint8Array; isTruncated: boolean }> {
  const stream: AsyncIterable<unknown> = response;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) continue;
    chunks.push(chunk);
    length += chunk.length;
    // Leaving the loop destroys the response, so nothing more is received.
    if (length > maximumBytes) break;
  }
  const body = Buffer.concat(chunks);
  return {
    body: body.subarray(0, maximumBytes),
    isTruncated: body.length > maximumBytes,
  };
}

async function requestPinnedPage(
  input: ConversationLinkRequest,
): Promise<ConversationLinkResponse> {
  const response = await openPinnedResponse(input);
  const status = response.statusCode ?? 0;
  const contentType = response.headers["content-type"] ?? "";
  const location = response.headers.location ?? null;
  if (status !== 200 || !input.acceptedTypes.has(mediaType(contentType))) {
    response.destroy();
    return {
      status,
      contentType,
      location,
      body: new Uint8Array(),
      isTruncated: false,
    };
  }
  const read = await readLimitedBody(response, input.maximumBytes);
  return { status, contentType, location, ...read };
}

/**
 * Fetches link previews and their images from the public internet.
 *
 * @remarks
 * The URL comes from a chat message, so every hop is treated as hostile:
 * only http(s) without credentials, only hosts whose every address is
 * public, the connection pinned to the checked address, at most three
 * redirects, and one time limit and one size limit per fetch.
 */
export class HttpConversationLinkFetcher implements ConversationLinkFetcher {
  private readonly lookup: (
    hostname: string,
  ) => Promise<readonly ConversationLinkAddress[]>;
  private readonly request: (
    input: ConversationLinkRequest,
  ) => Promise<ConversationLinkResponse>;
  private readonly isPublicAddress: (address: string) => boolean;
  private readonly timeoutMilliseconds: number;
  private readonly maximumBytes: number;

  /**
   * Creates the fetcher.
   *
   * @param options - Replacements for the network parts and the limits; production code passes none.
   */
  public constructor(options: HttpConversationLinkFetcherOptions = {}) {
    this.lookup = options.lookup ?? resolveWithDns;
    this.request = options.request ?? requestPinnedPage;
    this.isPublicAddress = options.isPublicAddress ?? isPublicAddress;
    this.timeoutMilliseconds =
      options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  }

  /**
   * Fetches a page and reads its title, description and image address.
   *
   * @remarks
   * A page longer than the size limit is read up to the limit.
   *
   * @param url - Address a chat message links to; untrusted.
   * @returns The preview; `null` for a refused address, a timeout, a network error, a status other than 200 or a page that is not HTML. Never throws.
   */
  public async fetch(url: string): Promise<ConversationLinkPreview | null> {
    const loaded = await this.load(url, HTML_TYPES);
    if (loaded === null) return null;
    const { response, finalUrl } = loaded;
    try {
      const html = decodeHtml(response.body, response.contentType);
      return readLinkPreview(html, finalUrl.href);
    } catch (error: unknown) {
      logCaughtError("ConversationLinkFetcher", error);
      return null;
    }
  }

  /**
   * Fetches a preview image, so browsers never contact the foreign site.
   *
   * @param url - Address of the image; untrusted.
   * @returns The complete image; `null` for a refused address, a timeout, a network error, a status other than 200, another media type or an image above the size limit. Never throws.
   */
  public async fetchImage(url: string): Promise<ConversationLinkImage | null> {
    const loaded = await this.load(url, IMAGE_TYPES);
    if (loaded === null || loaded.response.isTruncated) return null;
    const { body, contentType } = loaded.response;
    const mimeType = mediaType(contentType);
    if (!isImageType(mimeType) || body.length > this.maximumBytes) return null;
    return { bytes: body, mimeType };
  }

  /** Runs one fetch under the time limit; `null` unless the last hop answered 200 with an accepted type. */
  private async load(
    url: string,
    acceptedTypes: ReadonlySet<string>,
  ): Promise<LoadedResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMilliseconds);
    try {
      const loaded = await this.followRedirects(
        url,
        acceptedTypes,
        controller.signal,
      );
      const isAccepted =
        loaded?.response.status === 200 &&
        acceptedTypes.has(mediaType(loaded.response.contentType));
      return isAccepted ? loaded : null;
    } catch (error: unknown) {
      // Timeouts and unreachable or broken foreign servers are ordinary answers, not errors.
      if (!controller.signal.aborted && !isRemoteFailure(error))
        logCaughtError("ConversationLinkFetcher", error);
      return null;
    } finally {
      clearTimeout(timer);
      // Releases whatever a refused or finished fetch still holds open.
      controller.abort();
    }
  }

  /** Requests hop after hop; every hop passes the same checks as the first URL. */
  private async followRedirects(
    start: string,
    acceptedTypes: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<LoadedResponse | null> {
    let target = readPublicUrl(start);
    for (let hop = 0; target !== null && hop <= MAXIMUM_REDIRECTS; hop += 1) {
      const pinned = await this.resolvePublicAddress(target, signal);
      if (pinned === null) return null;
      const response = await untilAborted(
        this.request({
          url: target,
          address: pinned.address,
          family: pinned.family,
          signal,
          acceptedTypes,
          maximumBytes: this.maximumBytes,
        }),
        signal,
      );
      if (!REDIRECT_STATUSES.has(response.status))
        return { response, finalUrl: target };
      target =
        response.location === null
          ? null
          : readPublicUrl(response.location, target);
    }
    return null;
  }

  /** Returns the address to connect to; `null` unless every address of the host is public. */
  private async resolvePublicAddress(
    url: URL,
    signal: AbortSignal,
  ): Promise<ConversationLinkAddress | null> {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const version = isIP(hostname);
    const addresses =
      version === 0
        ? await untilAborted(this.lookup(hostname), signal)
        : [{ address: hostname, family: version === 6 ? 6 : 4 } as const];
    const isPublic = addresses.every((entry) =>
      this.isPublicAddress(entry.address),
    );
    return isPublic && addresses.length > 0 ? addresses[0] : null;
  }
}
