import { connect } from "node:net";

import type { RemoteFailureCode } from "@/definition/RemoteConnection";

/** The machine and port of an SSH server, before any key or account is known. */
export interface SshEndpoint {
  readonly host: string;
  readonly port: number;
}

const PROBE_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_GREETING = 4096;

const NETWORK_FAILURES: Readonly<Record<string, RemoteFailureCode>> = {
  ENOTFOUND: "host_unknown",
  EAI_AGAIN: "host_unknown",
  EAI_NONAME: "host_unknown",
  EAI_FAIL: "host_unknown",
  ECONNREFUSED: "unreachable_refused",
  ETIMEDOUT: "unreachable_timeout",
  EHOSTUNREACH: "unreachable_network",
  ENETUNREACH: "unreachable_network",
  EHOSTDOWN: "unreachable_network",
  ENETDOWN: "unreachable_network",
};

function networkFailure(error: unknown): RemoteFailureCode {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  return NETWORK_FAILURES[code] ?? "not_ssh";
}

/** RFC 4253 lets a server send other lines before its `SSH-` identification. */
function greetsWithSsh(greeting: string): boolean {
  return greeting.split("\n").some((line) => line.startsWith("SSH-"));
}

/**
 * Checks that the machine answers on the port and identifies as an SSH server.
 *
 * @remarks
 * This is the reachability stage of a connection test; it sends nothing and
 * signs in to nothing, so it tells network trouble apart from sign-in trouble.
 *
 * @param endpoint - Host name or address and port.
 * @returns `null` when an SSH server answered, otherwise the classified failure.
 */
export async function probeSshEndpoint(
  endpoint: SshEndpoint,
): Promise<RemoteFailureCode | null> {
  return new Promise((resolve) => {
    let greeting = "";
    let isConnected = false;
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    function finish(failure: RemoteFailureCode | null): void {
      clearTimeout(timer);
      socket.destroy();
      resolve(failure);
    }
    const timer = setTimeout(
      () => finish(isConnected ? "not_ssh" : "unreachable_timeout"),
      PROBE_TIMEOUT_MILLISECONDS,
    );
    socket.once("connect", () => {
      isConnected = true;
    });
    socket.on("data", (chunk: Buffer) => {
      greeting += chunk.toString("latin1");
      if (greetsWithSsh(greeting)) finish(null);
      else if (greeting.length > MAXIMUM_GREETING) finish("not_ssh");
    });
    socket.once("error", (error: Error) => finish(networkFailure(error)));
    socket.once("close", () =>
      finish(greetsWithSsh(greeting) ? null : "not_ssh"),
    );
  });
}
