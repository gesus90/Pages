import { useEffect, useRef, useState } from "react";

import { RemoteConsoleClient } from "./console-client";
import { createTerminalSurface } from "./terminal-surface";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/** Initializes browser terminal resources after hydration and releases them on disposal. */
export function useRemoteConsole(workspaceId: string): {
  readonly container: React.RefCallback<HTMLDivElement>;
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly reconnect: () => void;
  readonly restart: () => void;
} {
  const [sessionNumber, setSessionNumber] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const client = useRef<RemoteConsoleClient | null>(null);
  const [state, setState] = useState<RemoteConsoleState>({
    status: "connecting",
    attempts: 0,
    message: null,
    exitCode: null,
  });
  useEffect(() => {
    if (!element) return undefined;
    let isDisposed = false;
    let dispose: (() => void) | null = null;
    const releaseOnLeave = (): void => client.current?.dispose();
    window.addEventListener("pagehide", releaseOnLeave);
    async function start(target: HTMLDivElement): Promise<void> {
      try {
        const surface = await createTerminalSurface(target);
        if (isDisposed) {
          surface.dispose();
          return;
        }
        const connection = new RemoteConsoleClient({
          workspaceId,
          terminal: surface.terminal,
          onState: (nextState) => {
            if (nextState.status === "connected") setHasConnected(true);
            setState(nextState);
          },
        });
        client.current = connection;
        surface.terminal.onData((input) => connection.input(input));
        surface.terminal.onResize(() => connection.resize());
        dispose = () => {
          connection.dispose();
          surface.dispose();
        };
        await connection.start();
      } catch {
        if (!isDisposed)
          setState({
            status: "blocked",
            attempts: 0,
            message: "remote.console.loadFailed",
            exitCode: null,
          });
      }
    }
    void start(element);
    return () => {
      window.removeEventListener("pagehide", releaseOnLeave);
      isDisposed = true;
      dispose?.();
      client.current = null;
    };
  }, [element, workspaceId, sessionNumber]);
  return {
    container: setElement,
    state,
    hasConnected,
    reconnect: () => client.current?.reconnect(),
    restart: () => {
      setHasConnected(false);
      setState({
        status: "connecting",
        attempts: 0,
        message: null,
        exitCode: null,
      });
      setSessionNumber((previous) => previous + 1);
    },
  };
}
