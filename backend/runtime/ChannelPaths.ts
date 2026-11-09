import type { RemoteConsoleScope } from "@/backend/service/remote/RemoteConsoleService";

// The WebSocket paths of runners and consoles on the Pages port. The API's
// channels and the entrance both read them: the entrance passes each to the
// API or, behind its switch, to `pages-core` (PAGE-239).
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The channel lives next to the console route it belongs to. */
const CHANNEL_PATHS: readonly {
  readonly pattern: RegExp;
  readonly kind: RemoteConsoleScope["kind"];
}[] = [
  {
    pattern: new RegExp(`^/agents/workspaces/(${UUID})/console/socket$`, "u"),
    kind: "workspace",
  },
  {
    pattern: new RegExp(
      `^/agents/workspaces/remote/connections/(${UUID})/console/socket$`,
      "u",
    ),
    kind: "connection",
  },
  {
    pattern: new RegExp(
      `^/agents/workspaces/remote/connections/(${UUID})/setup/socket$`,
      "u",
    ),
    kind: "setup",
  },
];

/** The terminal of a plan node (PAGE-265): run and node in the path, plan and attempt in the query. */
const PLAN_TERMINAL_PATH = new RegExp(
  `^/agent-api/plan-runs/(${UUID})/steps/([^/]{1,200})/terminal/socket$`,
  "u",
);

/**
 * Run and node of a plan terminal channel.
 *
 * @param pathname - The decoded path of the request target.
 * @returns The run and the node, or `null` for another path.
 */
export function planTerminalOf(
  pathname: string,
): { readonly runId: string; readonly stepId: string } | null {
  const match = PLAN_TERMINAL_PATH.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  try {
    return { runId: match[1], stepId: decodeURIComponent(match[2]) };
  } catch {
    // A malformed escape names no node; the upgrade is left to the other handlers.
    return null;
  }
}

/**
 * Whether an upgrade request addresses the terminal of a plan node.
 *
 * @param url - The request target, path and query.
 * @returns `true` for `/agent-api/plan-runs/<run>/steps/<node>/terminal/socket`.
 */
export function isPlanTerminalChannel(url: string | undefined): boolean {
  if (!URL.canParse(url ?? "/", "http://pages.invalid")) return false;
  return (
    planTerminalOf(new URL(url ?? "/", "http://pages.invalid").pathname) !==
    null
  );
}

/** A runner's channel; matched against the whole request target, query included. */
export const RUNNER_CHANNEL_PATH = /^\/runner\/v1\/channel\/([a-f0-9-]{36})$/u;

/**
 * The console a channel path names.
 *
 * @param pathname - The decoded path of the request target.
 * @returns Kind and id of the console, or `null` for another path.
 */
export function consoleScopeOf(pathname: string): RemoteConsoleScope | null {
  for (const { pattern, kind } of CHANNEL_PATHS) {
    const id = pattern.exec(pathname)?.[1];
    if (id) return { kind, id };
  }
  return null;
}

/**
 * Whether an upgrade request addresses a console channel.
 *
 * @param url - The request target, path and query.
 * @returns `true` for the channel path of a workspace, connection or setup console.
 */
export function isRemoteConsoleChannel(url: string | undefined): boolean {
  // A malformed absolute request target must not throw inside the upgrade event.
  if (!URL.canParse(url ?? "/", "http://pages.invalid")) return false;
  return (
    consoleScopeOf(new URL(url ?? "/", "http://pages.invalid").pathname) !==
    null
  );
}

/**
 * Whether an upgrade request addresses a runner channel.
 *
 * @param url - The request target, path and query.
 * @returns `true` for `/runner/v1/channel/<connection>`, as the runner channel accepts it.
 */
export function isRunnerChannel(url: string | undefined): boolean {
  return RUNNER_CHANNEL_PATH.test(url ?? "");
}
