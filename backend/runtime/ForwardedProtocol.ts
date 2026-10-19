import { BlockList, isIP } from "node:net";

import { parseTrustedProxyEntry } from "@/backend/config/TrustedProxies";

import type { IncomingMessage } from "node:http";

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
 * overwrite the header, which is what Caddy and nginx (`$scheme`) do.
 * Anything but `http` or `https` in the header counts as not forwarded.
 */
export function createForwardedHttpsCheck(
  trustedProxies: readonly string[],
): (request: IncomingMessage) => boolean {
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

  // An IPv4 client of a dual-stack socket shows up as `::ffff:a.b.c.d`;
  // BlockList matches that form against IPv4 entries.
  function isTrustedPeer(address: string | undefined): boolean {
    const version = address === undefined ? 0 : isIP(address);

    if (address === undefined || version === 0) {
      return false;
    }

    return proxies.check(address, version === 4 ? "ipv4" : "ipv6");
  }

  return (request) =>
    isTrustedPeer(request.socket.remoteAddress) &&
    readForwardedProtocol(request.headers["x-forwarded-proto"]) === "https";
}

/**
 * Reads the protocol the first proxy of a chain saw.
 *
 * @returns `http`, `https`, or `null` for anything else.
 */
function readForwardedProtocol(
  header: string | string[] | undefined,
): "http" | "https" | null {
  const value = Array.isArray(header) ? header[0] : header;
  const protocol = value?.split(",")[0]?.trim().toLowerCase();

  return protocol === "http" || protocol === "https" ? protocol : null;
}
