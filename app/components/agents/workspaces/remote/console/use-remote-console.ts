import { useEffect, useRef, useState } from "react";

import { INITIAL_CONSOLE_STATE, RemoteConsoleClient } from "./console-client";
import { createTerminalSurface } from "./terminal-surface";

import type { Terminal } from "@xterm/xterm";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";

/** The live console of a panel: terminal element, server state and controls. */
export interface RemoteConsoleControls {
  readonly container: React.RefCallback<HTMLDivElement>;
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly reconnect: () => void;
  readonly restart: () => void;
  /** Moves the keyboard focus into the terminal; no effect before it is loaded. */
  readonly focus: () => void;
}

/**
 * Initializes browser terminal resources after hydration and releases them on disposal.
 *
 * @remarks
 * The terminal takes the keyboard focus as soon as its shell is ready, since
 * it is inert while the connection is being established.
 *
 * @param endpoint - Same-origin route of the workspace or connection console.
 * @returns Element callback, state and controls.
 */
export function useRemoteConsole(endpoint: string): RemoteConsoleControls {
  const [sessionNumber, setSessionNumber] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const client = useRef<RemoteConsoleClient | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const [state, setState] = useState<RemoteConsoleState>(INITIAL_CONSOLE_STATE);
  const isConnected = state.status === "connected";
  useEffect(() => {
    if (isConnected) terminal.current?.focus();
  }, [isConnected]);
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
          endpoint,
          terminal: surface.terminal,
          onState: (nextState) => {
            if (nextState.status === "connected") setHasConnected(true);
            setState(nextState);
          },
        });
        client.current = connection;
        terminal.current = surface.terminal;
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
            ...INITIAL_CONSOLE_STATE,
            status: "blocked",
            message: "remote.console.loadFailed",
          });
      }
    }
    void start(element);
    return () => {
      window.removeEventListener("pagehide", releaseOnLeave);
      isDisposed = true;
      dispose?.();
      client.current = null;
      terminal.current = null;
    };
  }, [element, endpoint, sessionNumber]);
  return {
    container: setElement,
    state,
    hasConnected,
    reconnect: () => client.current?.reconnect(),
    focus: () => terminal.current?.focus(),
    restart: () => {
      setHasConnected(false);
      setState(INITIAL_CONSOLE_STATE);
      setSessionNumber((previous) => previous + 1);
    },
  };
}
