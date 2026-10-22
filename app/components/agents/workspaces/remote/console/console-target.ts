import type {
  RemoteConnectionView,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

/** What a console panel connects to and how it names the machine. */
export interface RemoteConsoleTarget {
  /** Same-origin console route; it checks ownership and rights on every request. */
  readonly endpoint: string;
  /**
   * A whole connection starts in the login directory, a workspace in its
   * directory; a setup runs the guided runner setup instead of a shell.
   */
  readonly kind: "connection" | "workspace" | "setup";
  /** The name after „Konsole ·“: the connection or the workspace. */
  readonly title: string;
  /** The connection's name, used in the state texts. */
  readonly hostName: string;
  /** `user@host:port`; never contains credentials. */
  readonly address: string | null;
  /** `host:port`, named when the machine cannot be reached. */
  readonly endpointLabel: string | null;
  /** The known start directory, or `null` until the login directory is reported. */
  readonly directory: string | null;
}

/**
 * Describes a console on a whole connection, opened from its context menu.
 *
 * @param connection - A connection the person belongs to the department of.
 * @returns The panel target.
 */
export function connectionConsoleTarget(
  connection: RemoteConnectionView,
): RemoteConsoleTarget {
  const endpointLabel = `${connection.host}:${connection.port}`;
  return {
    endpoint: `/agents/workspaces/remote/connections/${encodeURIComponent(connection.id)}/console`,
    kind: "connection",
    title: connection.name,
    hostName: connection.name,
    address: `${connection.username}@${endpointLabel}`,
    endpointLabel,
    directory: null,
  };
}

/**
 * Describes the guided runner setup of a connection, opened from its context menu.
 *
 * @param connection - A connection an administrator who belongs to its department sets up.
 * @returns The panel target.
 */
export function connectionSetupTarget(
  connection: RemoteConnectionView,
): RemoteConsoleTarget {
  return {
    ...connectionConsoleTarget(connection),
    endpoint: `/agents/workspaces/remote/connections/${encodeURIComponent(connection.id)}/setup`,
    kind: "setup",
  };
}

/**
 * Describes a console in a registered remote workspace (PAGE-140).
 *
 * @param workspace - A workspace whose console the person may open.
 * @returns The panel target.
 */
export function workspaceConsoleTarget(
  workspace: RemoteWorkspaceView,
): RemoteConsoleTarget {
  const address = workspace.consoleAddress ?? null;
  return {
    endpoint: `/agents/workspaces/${encodeURIComponent(workspace.id)}/console`,
    kind: "workspace",
    title: workspace.name,
    hostName: workspace.connectionName,
    address,
    endpointLabel: address?.slice(address.lastIndexOf("@") + 1) ?? null,
    directory: workspace.path,
  };
}
