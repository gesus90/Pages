import { useEffect, useState } from "react";

import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";

/** Lines the Pages terminal keeps while older pages are loaded. */
const SCROLLBACK = 50_000;

/**
 * Loads the browser terminal of the Pages terminal once its container is in the page.
 *
 * @param container - The element xterm draws into.
 * @param onCloseRequest - The console's own way to close.
 * @remarks
 * xterm is imported only here, inside an effect, so the server renders the
 * console without it. The terminal only shows: Pages builds the input line
 * itself (PAGE-284).
 */
export function useTerminalSurface(
  container: React.RefObject<HTMLDivElement | null>,
  onCloseRequest: () => void,
): TerminalSurface | null {
  const [surface, setSurface] = useState<TerminalSurface | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let created: TerminalSurface | null = null;
    let isCancelled = false;
    void import("@/app/components/agents/workspaces/remote/console/terminal-surface")
      .then(({ createTerminalSurface }) =>
        createTerminalSurface(element, {
          isScreenReaderMode: false,
          onCloseRequest,
          scrollback: SCROLLBACK,
          palette: "agent-terminal",
          // xterm multiplies the cell height, not the font size: 15 px rows of 25 px as in the design.
          lineHeight: 1.45,
          isOutputOnly: true,
        }),
      )
      .then((next) => {
        if (isCancelled) {
          next.dispose();
          return;
        }
        // The terminal only shows; no cursor of its own.
        next.terminal.write("\u001b[?25l");
        created = next;
        setSurface(next);
      });
    return () => {
      isCancelled = true;
      created?.dispose();
    };
  }, [container, onCloseRequest]);
  return surface;
}

/**
 * The time now, renewed every second while `isTicking`, for running tools and countdowns.
 *
 * @param isTicking - Whether anything shown depends on the passing time.
 */
export function useNow(isTicking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTicking) return undefined;
    // A countdown that starts now counts from now, not from the first render.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isTicking]);
  return now;
}
