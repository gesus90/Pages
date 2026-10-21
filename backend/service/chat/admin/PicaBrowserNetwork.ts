import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { hostname, networkInterfaces } from "node:os";

import { PicaAdminError } from "./PicaAdminContracts";

const denied = new BlockList();
const pagesHosts = new Set<string>([hostname().toLowerCase()]);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === "IPv4") denied.addAddress(address.address, "ipv4");
  }
}

/** Adds observed/configured Pages hosts to a denylist; requests can only narrow access, never grant it. */
export function protectPagesOrigin(origin: string): void {
  if (pagesHosts.size < 100)
    pagesHosts.add(new URL(origin).hostname.toLowerCase());
}

for (const [address, prefix] of [
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
  ["224.0.0.0", 3],
] as const)
  denied.addSubnet(address, prefix, "ipv4");

/** Allows public HTTPS on its standard port only; URL credentials and local/address literals fail closed. */
export function publicBrowserUrl(input: string): URL {
  const url = new URL(input);
  if (
    pagesHosts.has(url.hostname.toLowerCase()) ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    isIP(url.hostname) !== 0 ||
    url.hostname.includes(":") ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test)$/iu.test(url.hostname)
  )
    throw new PicaAdminError("URL_DENIED");
  return url;
}

async function protectPagesAddresses(): Promise<void> {
  for (const host of pagesHosts) {
    if (isIP(host) === 4) {
      denied.addAddress(host, "ipv4");
      continue;
    }
    if (
      !host.includes(".") ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    )
      continue;
    const addresses = await lookup(host, { all: true, family: 4 });
    for (const entry of addresses) denied.addAddress(entry.address, "ipv4");
  }
}

/** Resolves every request, refuses mixed private answers and pins the exact public IPv4 address to TLS. */
export async function readPublicPage(input: {
  readonly url: URL;
  readonly signal: AbortSignal;
}): Promise<{ body: Buffer; contentType: string; status: number }> {
  await protectPagesAddresses();
  const addresses = await lookup(input.url.hostname, { all: true, family: 4 });
  if (
    !addresses.length ||
    addresses.some((entry) => denied.check(entry.address, "ipv4"))
  )
    throw new PicaAdminError("URL_DENIED");
  input.signal.throwIfAborted();
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const connection = request(
      input.url,
      {
        method: "GET",
        agent: false,
        signal: input.signal,
        timeout: 10_000,
        headers: {
          Host: input.url.host,
          "User-Agent": "Pages-Pica/1.0",
          Accept: "text/html,text/plain,text/css,application/javascript",
        },
        hostname: address,
        servername: input.url.hostname,
      },
      (response) => {
        const status = response.statusCode ?? 502;
        // Redirects are never followed implicitly, including redirects to Pages/private services.
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new PicaAdminError("REDIRECT_DENIED"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000)
            response.destroy(new PicaAdminError("RESULT_TOO_LARGE"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: response.headers["content-type"] ?? "text/plain",
            status,
          }),
        );
      },
    );
    connection.on("timeout", () =>
      connection.destroy(new PicaAdminError("BROWSER_TIMEOUT")),
    );
    connection.on("error", reject);
    connection.end();
  });
}
