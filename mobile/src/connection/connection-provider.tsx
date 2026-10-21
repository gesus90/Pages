import { createContext, useContext } from "react";
import { useNetworkState } from "expo-network";

import { useSettings } from "@/settings/settings-provider";
import { useServerConnection } from "./use-server-connection";

import type { ReactNode } from "react";
import type { ServerConnection } from "./use-server-connection";

interface ConnectionProviderProps {
  readonly children: ReactNode;
}

const ConnectionContext = createContext<ServerConnection>({
  status: "unconfigured",
  host: null,
  checkedAt: null,
  recheck: () => undefined,
});

/**
 * Shares the state of the connection to the Pages server with the app.
 *
 * @remarks
 * The connection check only asks the public health endpoint of Pages whether
 * the server answers. It opens no session and sends no credentials.
 */
export function ConnectionProvider({
  children,
}: ConnectionProviderProps): React.ReactElement {
  const { settings } = useSettings();
  const networkState = useNetworkState();
  // An unknown network state counts as online; the check itself finds out.
  const connection = useServerConnection(
    settings.serverUrl,
    networkState.isConnected !== false,
  );

  return (
    <ConnectionContext.Provider value={connection}>
      {children}
    </ConnectionContext.Provider>
  );
}

/**
 * Returns the connection to the configured Pages server.
 *
 * @returns Status, host, time of the last check and a function to check again.
 */
export function useConnection(): ServerConnection {
  return useContext(ConnectionContext);
}
