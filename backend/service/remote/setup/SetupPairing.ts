/** A setup step failed for a reason the person can act on; the reason is a translation key suffix. */
export class SetupReasonError extends Error {
  public readonly reason: string;

  public constructor(reason: string) {
    super(reason);
    this.name = "SetupReasonError";
    this.reason = reason;
  }
}

function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/gu, "").toLowerCase();
  return (
    name === "localhost" ||
    name === "::1" ||
    name.startsWith("127.") ||
    name.endsWith(".localhost")
  );
}

/**
 * The WS/WSS address the runner connects out to.
 *
 * @remarks
 * The operator's `PAGES_RUNNER_PUBLIC_URL` wins; otherwise it is the origin
 * the administrator reached Pages with. A loopback address is refused for a
 * machine that is not itself loopback, since it would only reach the machine.
 *
 * @param input - The origin of the request, the operator's address, the connection and its SSH host.
 * @returns The channel URL of the connection.
 * @throws {SetupReasonError} `addressUnknown` or `loopbackAddress`.
 */
export function pairingEndpoint(input: {
  readonly origin: string | null;
  readonly publicUrl: string | null;
  readonly connectionId: string;
  readonly sshHost: string;
}): string {
  const source = input.publicUrl ?? input.origin;
  if (source === null) throw new SetupReasonError("addressUnknown");
  const address = new URL(source);
  if (
    input.publicUrl === null &&
    isLoopbackHost(address.hostname) &&
    !isLoopbackHost(input.sshHost)
  )
    throw new SetupReasonError("loopbackAddress");
  const scheme = address.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${address.host}/runner/v1/channel/${input.connectionId}`;
}
