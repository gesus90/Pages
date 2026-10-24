import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { INITIAL_CONSOLE_STATE, RemoteConsoleClient } from "./console-client";
import { resolveScreenReaderMode } from "./screen-reader-mode";
import { createTerminalSurface } from "./terminal-surface";

import type { Terminal } from "@xterm/xterm";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { TerminalScreenReaderMode } from "@/definition/Settings";

/** The live console of a panel: terminal element, server state and controls. */
export interface RemoteConsoleControls {
  readonly container: React.RefCallback<HTMLDivElement>;
  readonly state: RemoteConsoleState;
  readonly hasConnected: boolean;
  readonly reconnect: () => void;
  readonly restart: () => void;
  /** Moves the keyboard focus into the terminal; no effect before it is loaded. */
  readonly focus: () => void;
  /** Whether an element belongs to the terminal, whose keys go to the shell. */
  readonly contains: (target: EventTarget | null) => boolean;
}

/** What a panel asks of its console besides the route. */
export interface RemoteConsoleOptions {
  /** Same-origin route of the workspace or connection console. */
  readonly endpoint: string;
  readonly screenReader: TerminalScreenReaderMode;
  /** Strg+Umschalt+X in the terminal; Escape stays with the shell. */
  readonly onCloseRequest: () => void;
}

/**
 * Initializes browser terminal resources after hydration and releases them on disposal.
 *
 * @remarks
 * The terminal takes the keyboard focus as soon as its shell is ready, since
 * it is inert while the connection is being established. The screen reader
 * mode is decided once per terminal.
 *
 * @param options - Route, screen reader setting and close request.
 * @returns Element callback, state and controls.
 */
export function useRemoteConsole(
  options: RemoteConsoleOptions,
): RemoteConsoleControls {
  const { endpoint, screenReader } = options;
  const { t } = useTranslation();
  const [sessionNumber, setSessionNumber] = useState(0);
  const [hasConnected, setHasConnected] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const client = useRef<RemoteConsoleClient | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const closeRequest = useRef(options.onCloseRequest);
  const gapNotice = useRef(t("remote.console.outputGap"));
  const [state, setState] = useState<RemoteConsoleState>(INITIAL_CONSOLE_STATE);
  const isConnected = state.status === "connected";
  useEffect(() => {
    closeRequest.current = options.onCloseRequest;
    gapNotice.current = t("remote.console.outputGap");
  }, [options.onCloseRequest, t]);
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
        const surface = await createTerminalSurface(target, {
          isScreenReaderMode: resolveScreenReaderMode(screenReader),
          onCloseRequest: () => closeRequest.current(),
        });
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
          notices: {
            // A marked line in the scrollback, so the missing part is never mistaken for none.
            onGap: () =>
              surface.terminal.write(
                `\r\n\x1b[7m ${gapNotice.current} \x1b[0m\r\n`,
              ),
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
  }, [element, endpoint, sessionNumber, screenReader]);
  return {
    container: setElement,
    state,
    hasConnected,
    reconnect: () => client.current?.reconnect(),
    focus: () => terminal.current?.focus(),
    contains: (target) =>
      target instanceof Node && element !== null && element.contains(target),
    restart: () => {
      setHasConnected(false);
      setState(INITIAL_CONSOLE_STATE);
      setSessionNumber((previous) => previous + 1);
    },
  };
}
