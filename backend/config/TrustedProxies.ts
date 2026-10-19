import { isIP } from "node:net";

const HIGHEST_PREFIX = { ipv4: 32, ipv6: 128 } as const;

/** One entry of the `trustedProxies` setting, split into its parts. */
export interface TrustedProxyEntry {
  /** Address of the proxy, or the network address of a range. */
  readonly address: string;
  readonly family: keyof typeof HIGHEST_PREFIX;
  /** Length of the network prefix, or `null` for a single address. */
  readonly prefix: number | null;
}

/**
 * Reads one entry of the `trustedProxies` setting.
 *
 * @param entry - An IPv4 or IPv6 address, optionally followed by `/prefix`.
 * @returns The parts of the entry, or `null` when it is not a valid address
 * or range.
 *
 * @remarks
 * A prefix of 0 is refused: it would name every address and so trust every
 * client. Host names and zone identifiers are refused as well, because the
 * entry is compared with the address of the connection, not looked up.
 */
export function parseTrustedProxyEntry(
  entry: string,
): TrustedProxyEntry | null {
  const parts = entry.split("/");
  const [address, prefixText] = parts;

  if (address === undefined || parts.length > 2 || address.includes("%")) {
    return null;
  }

  const version = isIP(address);

  if (version === 0) {
    return null;
  }

  const family = version === 4 ? "ipv4" : "ipv6";

  if (prefixText === undefined) {
    return { address, family, prefix: null };
  }

  // Text that is not a whole number counts as 0, which is refused below.
  const prefix = /^\d{1,3}$/u.test(prefixText) ? Number(prefixText) : 0;

  if (prefix < 1 || prefix > HIGHEST_PREFIX[family]) {
    return null;
  }

  return { address, family, prefix };
}
