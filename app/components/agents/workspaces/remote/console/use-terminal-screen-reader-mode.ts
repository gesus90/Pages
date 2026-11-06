import { createContext, useContext } from "react";
import { useRouteLoaderData } from "react-router";

import { isTerminalScreenReaderMode } from "@/definition/Settings";

import type { TerminalScreenReaderMode } from "@/definition/Settings";

/**
 * The mode the workspace directory shows, which may be newer than its loader
 * data while the directory opened from the browser's local state.
 */
export const TerminalScreenReaderModeContext =
  createContext<TerminalScreenReaderMode | null>(null);

/**
 * The person's screen reader mode of the remote console, as the workspace
 * directory loaded it.
 *
 * @returns The stored mode, or `auto` where the page did not load one.
 */
export function useTerminalScreenReaderMode(): TerminalScreenReaderMode {
  const shown = useContext(TerminalScreenReaderModeContext);
  const loaded: unknown = useRouteLoaderData("routes/agent-workspaces");
  if (shown) return shown;
  const mode =
    typeof loaded === "object" &&
    loaded !== null &&
    "terminalScreenReader" in loaded
      ? loaded.terminalScreenReader
      : null;
  return isTerminalScreenReaderMode(mode) ? mode : "auto";
}
