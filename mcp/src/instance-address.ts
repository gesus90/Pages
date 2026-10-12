import { isIPv4 } from "node:net";

/** Accepts exactly RFC 1918 IPv4 addresses used by the Pages intranet. */
export function isPrivateIpv4(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [first, second] = host.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Validates an instance address before any request or credential lookup. */
export function readInstanceUrl(input: string | undefined): URL {
  if (!input || input.trim() !== input)
    throw new Error("PAGES_URL must be an absolute HTTP(S) instance URL.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("PAGES_URL must be an absolute HTTP(S) instance URL.");
  }
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    isPrivateIpv4(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "PAGES_URL requires HTTPS (or loopback/private IPv4 HTTP), without credentials, query or fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/** Builds an endpoint beneath the validated instance prefix. */
export function instanceEndpoint(instance: URL, endpoint: string): URL {
  const url = new URL(instance.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${endpoint}`;
  return url;
}
