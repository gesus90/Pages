import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const deniedAddresses = new BlockList();
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
  deniedAddresses.addSubnet(address, prefix, "ipv4");
deniedAddresses.addSubnet("2001::", 23, "ipv6");
deniedAddresses.addSubnet("2001:db8::", 32, "ipv6");
deniedAddresses.addSubnet("2002::", 16, "ipv6");

/** Rejects private, special-purpose and mapped addresses before a pinned HTTPS connection. */
export function isPublicOAuthAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deniedAddresses.check(address, "ipv4");
  return (
    family === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !deniedAddresses.check(address, "ipv6")
  );
}

/** Retrieves a public CIMD document without redirects, cookies, DNS rebinding or unbounded bodies. */
export async function fetchOAuthMetadata(clientId: string): Promise<unknown> {
  const url = new URL(clientId);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname === "/"
  ) {
    throw new Error("Invalid client metadata location.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  const selected = addresses[0];
  if (
    !selected ||
    !addresses.every((address) => isPublicOAuthAddress(address.address))
  ) {
    throw new Error("Invalid client metadata location.");
  }
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        agent: false,
        headers: { Accept: "application/json" },
        lookup: (hostname, options, callback) =>
          callback(null, selected.address, selected.family),
      },
      (incoming) => {
        if (
          incoming.statusCode !== 200 ||
          !incoming.headers["content-type"]?.startsWith("application/json")
        ) {
          incoming.resume();
          reject(new Error("Invalid client metadata response."));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        incoming.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 65_536) {
            outgoing.destroy(new Error("Client metadata is too large."));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          try {
            const metadata: unknown = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            );
            resolve(metadata);
          } catch {
            reject(new Error("Invalid client metadata response."));
          }
        });
      },
    );
    outgoing.setTimeout(5_000, () =>
      outgoing.destroy(new Error("Client metadata timed out.")),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}
