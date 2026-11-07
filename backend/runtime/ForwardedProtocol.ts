import { BlockList, isIP } from "node:net";

import { parseTrustedProxyEntry } from "@/backend/config/TrustedProxies";

import type { IncomingMessage } from "node:http";
import type { ReportedProtocol, RequestEntry } from "@/definition/RequestEntry";

/** Tells whether the TCP peer of a request is a hop whose forwarding headers are believed. */
export type PeerCheck = (address: string | undefined) => boolean;

/**
 * Headers of other forwarding conventions.
 *
 * @remarks
 * Pages reads only `X-Forwarded-Proto`, `X-Forwarded-For` and `Host`. No
 * entrance passes one of these on, so a value a client wrote cannot reach a
 * later reader that might believe it.
 */
export const UNSUPPORTED_FORWARDING_HEADERS: readonly string[] = [
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-server",
  "x-forwarded-ssl",
  "x-real-ip",
  "front-end-https",
  "x-url-scheme",
];

/**
 * Builds the check that tells whether a TCP peer is a trusted proxy.
 *
 * @param trustedProxies - Addresses or ranges from the `trustedProxies` setting.
 * @param options - `isLoopbackTrusted` also trusts every loopback peer.
 * @returns A check of the peer address of a socket.
 *
 * @remarks
 * An IPv4 client of a dual-stack socket shows up as `::ffff:a.b.c.d`;
 * BlockList matches that form against IPv4 entries.
 */
export function createTrustedPeerCheck(
  trustedProxies: readonly string[],
  options: { readonly isLoopbackTrusted?: boolean } = {},
): PeerCheck {
  const proxies = new BlockList();

  for (const entry of trustedProxies) {
    const parsed = parseTrustedProxyEntry(entry);

    if (parsed === null) {
      continue;
    }

    if (parsed.prefix === null) {
      proxies.addAddress(parsed.address, parsed.family);
    } else {
      proxies.addSubnet(parsed.address, parsed.prefix, parsed.family);
    }
  }

  if (options.isLoopbackTrusted === true) {
    proxies.addSubnet("127.0.0.0", 8, "ipv4");
    proxies.addAddress("::1", "ipv6");
  }

  return (address) => {
    const version = address === undefined ? 0 : isIP(address);

    if (address === undefined || version === 0) {
      return false;
    }

    return proxies.check(address, version === 4 ? "ipv4" : "ipv6");
  };
}

/**
 * Builds the check that tells whether a trusted proxy forwarded a request that
 * reached it over HTTPS.
 *
 * @param trustedProxies - Addresses or ranges from the `trustedProxies` setting.
 * @returns A check that is true only when the TCP peer of the request is one of
 * the trusted proxies and its `X-Forwarded-Proto` names `https`.
 *
 * @remarks
 * The proxy hands requests to Pages over plain HTTP, so the protocol of the
 * connection is `http` while the browser sent its `Origin` as `https`. React
 * Router refuses such an action as a possible forgery. The peer address comes
 * from the socket and cannot be set by a client; without a match the header
 * is ignored, so a direct client gains nothing by sending it. The proxy must
 * overwrite the header with the protocol of the connection it received, which
 * is what Caddy and an nginx that ends TLS itself (`$scheme`) do. A proxy
 * that only passes on a request another hop received over TLS keeps the
 * header of that hop instead, but only from an address it trusts itself
 * (`deploy/proxy/README.md`). Anything but `http` or `https` in the header
 * counts as not forwarded.
 */
export function createForwardedHttpsCheck(
  trustedProxies: readonly string[],
): (request: IncomingMessage) => boolean {
  const isTrustedPeer = createTrustedPeerCheck(trustedProxies);

  return (request) =>
    isTrustedPeer(request.socket.remoteAddress) &&
    readForwardedProtocol(request.headers["x-forwarded-proto"]) === "https";
}

/**
 * Reads the client a proxy in front of Pages reports, such as the static app's entrance.
 *
 * @param peer - The TCP peer of the request.
 * @param forwardedFor - The request's `X-Forwarded-For`.
 * @param isTrustedPeer - Whether the peer is a proxy whose header is believed.
 * @returns The address the nearest proxy saw, the last of the header, when
 * the peer is trusted and named one; the peer otherwise.
 *
 * @remarks
 * The static app's entrance (PAGE-235) connects over loopback for every
 * browser. Without this, every visitor of the entrance would look like a
 * local process, which some checks of the MCP endpoints allow more. A client
 * that connects directly cannot change its address with the header.
 */
export function forwardedClientAddress(
  peer: string,
  forwardedFor: string | null,
  isTrustedPeer: (address: string | undefined) => boolean,
): string {
  if (forwardedFor === null || !isTrustedPeer(peer)) return peer;
  const nearest = forwardedFor.split(",").at(-1)?.trim() ?? "";
  return isIP(nearest) === 0 ? peer : nearest;
}

/**
 * Reads the protocol the first proxy of a chain saw.
 *
 * @param header - The `X-Forwarded-Proto` value; a list reads as its first entry.
 * @returns `http`, `https`, or `null` for anything else.
 */
export function readForwardedProtocol(
  header: string | string[] | undefined,
): "http" | "https" | null {
  const value = Array.isArray(header) ? header[0] : header;
  const protocol = value?.split(",")[0]?.trim().toLowerCase();

  return protocol === "http" || protocol === "https" ? protocol : null;
}

function reportedProtocolOf(header: string | null): ReportedProtocol {
  if (header === null || header.trim() === "") return "absent";

  return readForwardedProtocol(header) ?? "invalid";
}

/** Which peers the entrance of the API believes, and for what. */
export interface PeerTrust {
  /** A proxy listed in `trustedProxies`: its `X-Forwarded-Proto` is believed. */
  readonly isTrustedProxy: PeerCheck;
  /** A listed proxy or a loopback peer: its `X-Forwarded-For` is believed. */
  readonly isTrustedClientPeer: PeerCheck;
}

/** The connection and the protocol the entrance of the API built a request with. */
export interface AdmittedRequest {
  /** The TCP peer of the request. */
  readonly peer: string;
  /** The protocol of the request URL: `https` only for a trusted proxy that said so. */
  readonly protocol: "http" | "https";
}

/**
 * Admits the forwarding headers of a request at the entrance of the API.
 *
 * @param headers - Headers of the request; changed in place.
 * @param request - Peer and protocol the request was built with.
 * @param trust - Which peers are believed.
 * @returns How the request arrived, for the origin guards and their log.
 *
 * @remarks
 * A hop is believed only for what it is trusted with: `X-Forwarded-Proto`
 * from a listed proxy, `X-Forwarded-For` from a listed or loopback peer.
 * Afterwards `X-Forwarded-Proto` names the protocol the request URL has,
 * `X-Forwarded-For` holds the peer when the peer is not believed, and the
 * headers of other conventions are gone, so nothing behind the entrance has
 * to decide again whether a client may have written them.
 */
export function admitForwardedHeaders(
  headers: Headers,
  request: AdmittedRequest,
  trust: PeerTrust,
): RequestEntry {
  const reportedProtocol = reportedProtocolOf(headers.get("x-forwarded-proto"));
  const isTrustedClientPeer = trust.isTrustedClientPeer(request.peer);
  const entry: RequestEntry = {
    reportedProtocol,
    isTrustedProxy: trust.isTrustedProxy(request.peer),
    isForwarded:
      isTrustedClientPeer ||
      reportedProtocol !== "absent" ||
      headers.has("x-forwarded-for"),
  };

  for (const name of UNSUPPORTED_FORWARDING_HEADERS) headers.delete(name);
  if (!isTrustedClientPeer) headers.set("x-forwarded-for", request.peer);
  headers.set("x-forwarded-proto", request.protocol);

  return entry;
}
