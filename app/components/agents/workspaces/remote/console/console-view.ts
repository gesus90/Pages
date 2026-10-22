import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/**
 * What the console panel shows, derived from the server state and whether a
 * shell ran in this session.
 */
export type ConsoleView =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "lost"
  | "exited"
  | "authFailed"
  | "hostKeyChanged"
  | "unreachable"
  | "ptyUnavailable"
  | "accessRevoked"
  | "failed";

/** A shell is open or being opened; closing it needs a confirmation. */
export const ACTIVE_CONSOLE_VIEWS: ReadonlySet<ConsoleView> = new Set([
  "connecting",
  "connected",
  "reconnecting",
]);

/** No shell is shown; a centered message replaces the terminal. */
export const OVERLAY_CONSOLE_VIEWS: ReadonlySet<ConsoleView> = new Set([
  "connecting",
  "authFailed",
  "hostKeyChanged",
  "unreachable",
  "ptyUnavailable",
  "accessRevoked",
  "failed",
]);

function failureKeys(codes: readonly string[]): ReadonlySet<string> {
  return new Set(codes.map((code) => `remote.failure.${code}`));
}

const SIGN_IN_FAILURES = failureKeys([
  "password_rejected",
  "key_rejected",
  "passphrase_wrong",
  "passphrase_required",
  "key_invalid",
  "secret_missing",
]);
const REACH_FAILURES = new Set([
  ...failureKeys([
    "host_unknown",
    "unreachable_refused",
    "unreachable_timeout",
    "unreachable_network",
    "not_ssh",
    "transport_lost",
  ]),
  "remote.error.remote_reconnecting",
  "remote.error.remote_blocked",
]);
const REVOKED = new Set([
  "remote.error.remote_access_denied",
  "remote.error.remote_management_denied",
  "remote.error.remote_workspace_not_found",
  "remote.error.remote_connection_not_found",
]);
const NO_TERMINAL = new Set([
  "remote.console.ptyUnavailable",
  "remote.console.loadFailed",
]);

function blockedView(
  message: string | null,
  hasConnected: boolean,
): ConsoleView {
  if (message === null) return "failed";
  if (REVOKED.has(message)) return "accessRevoked";
  if (NO_TERMINAL.has(message)) return "ptyUnavailable";
  if (message === "remote.failure.host_key_changed") return "hostKeyChanged";
  if (SIGN_IN_FAILURES.has(message)) return "authFailed";
  // After a shell ran, an outage that outlasted the retries keeps the scrollback.
  if (hasConnected) return "lost";
  if (REACH_FAILURES.has(message)) return "unreachable";
  return "failed";
}

/**
 * Maps the console state to one of the panel's views.
 *
 * @param state - The state the server or the browser transport reported.
 * @param hasConnected - Whether a shell ran in this session.
 * @returns The view to render.
 */
export function consoleViewOf(
  state: RemoteConsoleState,
  hasConnected: boolean,
): ConsoleView {
  switch (state.status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "reconnecting":
      return hasConnected ? "reconnecting" : "connecting";
    case "blocked":
      return blockedView(state.message, hasConnected);
    case "ended":
      if (state.message !== null && REVOKED.has(state.message))
        return "accessRevoked";
      return state.message === null ? "exited" : "failed";
  }
}
