import { useRouteLoaderData } from "react-router";

import { isTerminalScreenReaderMode } from "@/definition/Settings";

import type { TerminalScreenReaderMode } from "@/definition/Settings";

/**
 * The person's screen reader mode of the remote console, as the workspace
 * directory loaded it.
 *
 * @returns The stored mode, or `auto` where the page did not load one.
 */
export function useTerminalScreenReaderMode(): TerminalScreenReaderMode {
  const loaded: unknown = useRouteLoaderData("routes/agent-workspaces");
  const mode =
    typeof loaded === "object" &&
    loaded !== null &&
    "terminalScreenReader" in loaded
      ? loaded.terminalScreenReader
      : null;
  return isTerminalScreenReaderMode(mode) ? mode : "auto";
}
