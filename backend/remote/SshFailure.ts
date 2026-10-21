import type {
  RemoteAuthMethod,
  RemoteFailureCode,
} from "@/definition/RemoteConnection";
import type { SshProcessResult } from "./SshProcess";

/** Exit code OpenSSH uses for its own failures, as opposed to the remote command's. */
export const SSH_FAILURE_EXIT_CODE = 255;

/**
 * Messages of OpenSSH (run with `LC_ALL=C` and `LogLevel=ERROR`) and the
 * failure each one means; the first match wins.
 */
const FAILURE_PATTERNS: readonly (readonly [RegExp, RemoteFailureCode])[] = [
  [
    /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key .* (?:has changed|is known)/iu,
    "host_key_changed",
  ],
  [/no matching host key type|Unable to negotiate/iu, "host_key_changed"],
  [
    /Could not resolve hostname|Name or service not known|name resolution/iu,
    "host_unknown",
  ],
  [/Connection refused/iu, "unreachable_refused"],
  [/No route to host|Network is unreachable/iu, "unreachable_network"],
  [/incorrect passphrase|bad passphrase/iu, "passphrase_wrong"],
  [/invalid format|error in libcrypto|Load key/iu, "key_invalid"],
  [
    /Connection timed out|Operation timed out|timed out/iu,
    "unreachable_timeout",
  ],
  [
    /not responding|Connection closed|Connection reset|Broken pipe|kex_exchange_identification|mux_client|Control socket/iu,
    "transport_lost",
  ],
];

function rejectedCredential(method: RemoteAuthMethod): RemoteFailureCode {
  return method === "password" ? "password_rejected" : "key_rejected";
}

/**
 * Classifies a failed `ssh` run without passing any of its text on.
 *
 * @param result - The finished `ssh` process.
 * @param method - The sign-in method, which decides what a refusal means.
 * @returns The failure, or `null` when OpenSSH itself did not fail.
 */
export function classifySshFailure(
  result: SshProcessResult,
  method: RemoteAuthMethod,
): RemoteFailureCode | null {
  if (result.isUnavailable) return "ssh_unavailable";
  if (result.isTimedOut) return "unreachable_timeout";
  if (result.exitCode !== SSH_FAILURE_EXIT_CODE) return null;
  if (
    /Permission denied|Too many authentication failures/iu.test(result.stderr)
  )
    return rejectedCredential(method);
  const match = FAILURE_PATTERNS.find(([pattern]) =>
    pattern.test(result.stderr),
  );
  return match ? match[1] : "remote_failed";
}

/**
 * Classifies a failed `ssh-keygen -y` run that tried to read a private key.
 *
 * @param result - The finished `ssh-keygen` process.
 * @param method - Whether the key was given with a passphrase.
 * @returns The failure, or `null` when the key could be read.
 */
export function classifyKeyFailure(
  result: SshProcessResult,
  method: RemoteAuthMethod,
): RemoteFailureCode | null {
  if (result.isUnavailable) return "ssh_unavailable";
  if (result.exitCode === 0) return null;
  if (/incorrect passphrase|bad passphrase/iu.test(result.stderr))
    return method === "key_passphrase"
      ? "passphrase_wrong"
      : "passphrase_required";
  return "key_invalid";
}
