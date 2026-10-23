import { networkInterfaces } from "node:os";

const WILDCARD_HOSTS: readonly string[] = ["0.0.0.0", "::"];
const LINK_LOCAL_PREFIX = "169.254.";

/** What decides the host a smartphone is told to connect to. */
export interface PicaMobileHostInput {
  /** Host the administrator's browser used to open Pages. */
  readonly requestHostname: string;
  /** `listenAddress` of the configuration, when one is set. */
  readonly listenAddress?: string;
  /** External IPv4 addresses of this machine. */
  readonly networkAddresses: readonly string[];
}

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/gu, "");
}

function isLoopbackHost(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();

  return (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare === "::1" ||
    bare.startsWith("127.") ||
    WILDCARD_HOSTS.includes(bare)
  );
}

/**
 * Lists the external IPv4 addresses of this machine.
 *
 * @returns Addresses of the network interfaces that a smartphone in the same
 * network can reach; loopback and link-local addresses are left out.
 */
export function listExternalIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter(
      (address) =>
        address.family === "IPv4" &&
        !address.internal &&
        !address.address.startsWith(LINK_LOCAL_PREFIX),
    )
    .map((address) => address.address);
}

/**
 * Chooses the host the app should connect to.
 *
 * @param input - Browser host, configured listen address and machine addresses.
 * @returns A host a smartphone can use, or `null` when there is none. A
 * loopback name such as `localhost` is never returned, since it points at the
 * phone itself.
 *
 * @remarks
 * A configured listen address wins, since the endpoint only answers there.
 * Otherwise the host the browser used is taken, which is the name the
 * administrator already knows works; when that is loopback, the first
 * external address of the machine stands in.
 */
export function resolvePicaMobileHost(
  input: PicaMobileHostInput,
): string | null {
  const { listenAddress, requestHostname, networkAddresses } = input;

  if (listenAddress !== undefined && !WILDCARD_HOSTS.includes(listenAddress)) {
    return isLoopbackHost(listenAddress) ? null : stripBrackets(listenAddress);
  }

  if (!isLoopbackHost(requestHostname)) {
    return stripBrackets(requestHostname);
  }

  return networkAddresses[0] ?? null;
}
