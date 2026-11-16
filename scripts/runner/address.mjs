/** Validates an origin and defaults to authenticated TLS, independently of browser transport. */
export function runnerAddress(source, allowInsecureLan = false) {
  const address = new URL(source);
  if (
    !["https:", "http:", "wss:", "ws:"].includes(address.protocol) ||
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    address.pathname !== "/"
  )
    throw new Error("Invalid runner Pages address");
  address.protocol = allowInsecureLan ? "ws:" : "wss:";
  return address.origin;
}

/** Requires explicit consent for plaintext and binds a new address to the existing identity. */
export function runnerEndpoint(endpoint, options = {}) {
  const address = new URL(endpoint);
  if (
    !["ws:", "wss:"].includes(address.protocol) ||
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    !/^\/runner\/v1\/channel\/[a-f0-9-]{36}$/u.test(address.pathname)
  )
    throw new Error("Invalid runner endpoint");
  if (
    options.connectionId &&
    !address.pathname.endsWith(`/${options.connectionId}`)
  )
    throw new Error("Runner address identity mismatch");
  if (options.isLocal) {
    requireLocalEndpoint(address);
  } else if (address.protocol === "ws:" && options.allowInsecureLan !== true) {
    throw new Error("Plaintext runner tokens require explicit LAN consent");
  }
  return address.href;
}

function requireLocalEndpoint(address) {
  if (
    address.protocol !== "ws:" ||
    address.hostname !== "127.0.0.1" ||
    !address.pathname.endsWith("/00000000-0000-4000-8000-000000000001")
  )
    throw new Error("Local runner requires IPv4 loopback");
}
