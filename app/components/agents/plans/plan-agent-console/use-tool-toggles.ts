import { useEffect, useRef, useState } from "react";

import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";
import type { TerminalRows } from "./terminal-lines";

/** The calls whose full output the reader opened, and how to open or close one. */
export interface ToolToggles {
  readonly expandedCalls: ReadonlySet<string>;
  readonly toggle: (callId: string) => void;
}

/**
 * Keeps which tool outputs are open; the stable `toolCallId` names each call.
 * @remarks
 * Opening a call only shows its stored output again; nothing is read anew.
 */
export function useExpandedCalls(): ToolToggles {
  const [expandedCalls, setExpandedCalls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  function toggle(callId: string): void {
    setExpandedCalls((current) => {
      const next = new Set(current);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }
  return { expandedCalls, toggle };
}

/**
 * Makes the "show details" words of the terminal clickable.
 * @param surface - The terminal, once it is loaded.
 * @param rows - The rows the terminal shows now, with their toggles.
 * @param toggle - Opens or closes the output of a call.
 * @remarks
 * xterm counts buffer lines from 1. When the scrollback limit dropped rows
 * at the top, the buffer starts later in the text, so the row of a buffer
 * line is shifted by the dropped rows.
 */
export function useToolToggleLinks(
  surface: TerminalSurface | null,
  rows: TerminalRows,
  toggle: (callId: string) => void,
): void {
  const latest = useRef({ rows, toggle });
  useEffect(() => {
    latest.current = { rows, toggle };
  }, [rows, toggle]);
  useEffect(() => {
    if (!surface) return undefined;
    const { terminal } = surface;
    const provider = terminal.registerLinkProvider({
      provideLinks(bufferLine, callback) {
        const current = latest.current;
        const dropped = Math.max(
          0,
          current.rows.rows.length - terminal.buffer.active.length,
        );
        const row = bufferLine - 1 + dropped;
        const links = current.rows.toggles
          .filter((entry) => entry.row === row)
          .map((entry) => ({
            range: {
              start: { x: entry.startColumn, y: bufferLine },
              end: { x: entry.endColumn, y: bufferLine },
            },
            text: entry.callId,
            decorations: { pointerCursor: true, underline: true },
            activate: () => latest.current.toggle(entry.callId),
          }));
        callback(links.length > 0 ? links : undefined);
      },
    });
    return () => provider.dispose();
  }, [surface]);
}
