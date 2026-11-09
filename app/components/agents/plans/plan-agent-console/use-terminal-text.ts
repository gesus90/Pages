import { useEffect, useRef, useState } from "react";

import type { IBuffer, Terminal } from "@xterm/xterm";
import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";
import type { TerminalRows } from "./terminal-lines";

const HIDE_CURSOR = "\u001b[?25l";
/** xterm draws nothing between these two, so a rewrite shows no empty or half state. */
const SYNC_START = "\u001b[?2026h";
const SYNC_END = "\u001b[?2026l";
/** RIS: clears screen and scrollback inside the same write as the new text. */
const FULL_RESET = "\u001bc";
const ERASE_BELOW = "\u001b[J";

interface WrittenRows extends TerminalRows {
  readonly surface: TerminalSurface | null;
}

/** Where the reader looks: a line before wrapping, counted from the end, and the row within it. */
interface ReadingPosition {
  readonly isAtBottom: boolean;
  readonly linesFromEnd: number;
  readonly rowInLine: number;
}

function firstDifference(
  before: readonly string[],
  after: readonly string[],
): number {
  const length = Math.min(before.length, after.length);
  for (let index = 0; index < length; index += 1)
    if (before[index] !== after[index]) return index;
  return length;
}

/** Rows the scrollback limit dropped at the top; the buffer then starts later in the text. */
function droppedRows(buffer: IBuffer, rowCount: number): number {
  return Math.max(0, rowCount - buffer.length);
}

/** The line of the first row the reader sees: the last line that starts at or before it. */
function lineAt(lineStarts: readonly number[], row: number): number {
  let line = 0;
  while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? 0) <= row)
    line += 1;
  return line;
}

function readingPosition(
  buffer: IBuffer,
  written: TerminalRows,
): ReadingPosition {
  const top = buffer.viewportY + droppedRows(buffer, written.rows.length);
  const line = lineAt(written.lineStarts, top);
  return {
    isAtBottom: buffer.viewportY >= buffer.baseY,
    linesFromEnd: written.lineStarts.length - line,
    rowInLine: top - (written.lineStarts[line] ?? 0),
  };
}

/** Scrolls back to the line the reader looked at, however it wraps now. */
function restore(
  terminal: Terminal,
  next: TerminalRows,
  position: ReadingPosition,
): void {
  if (position.isAtBottom) {
    terminal.scrollToBottom();
    return;
  }
  const { lineStarts, rows } = next;
  const line = Math.max(0, lineStarts.length - position.linesFromEnd);
  const start = lineStarts[line] ?? 0;
  const end = lineStarts[line + 1] ?? rows.length;
  const row =
    start + Math.min(position.rowInLine, Math.max(0, end - start - 1));
  terminal.scrollToLine(
    Math.max(0, row - droppedRows(terminal.buffer.active, rows.length)),
  );
}

/**
 * Rewrites only the rows from the first changed one, when the cursor can
 * still reach it: the last line of a streamed answer that wraps anew.
 */
function rewriteTail(
  terminal: Terminal,
  before: readonly string[],
  after: readonly string[],
): boolean {
  const changed = firstDifference(before, after);
  const rowsUp = before.length - 1 - changed;
  // Fewer rows than before leave the cursor below the end; a whole rewrite places it right.
  if (changed >= after.length || rowsUp > terminal.buffer.active.cursorY)
    return false;
  const up = rowsUp > 0 ? `\u001b[${rowsUp}A` : "";
  terminal.write(
    `${SYNC_START}\r${up}${ERASE_BELOW}${after.slice(changed).join("\r\n")}${SYNC_END}`,
  );
  return true;
}

/** Writes the whole text in one write, keeping the line the reader looks at in place. */
function rewriteAll(
  terminal: Terminal,
  written: TerminalRows,
  next: TerminalRows,
): void {
  const position = readingPosition(terminal.buffer.active, written);
  terminal.write(
    `${FULL_RESET}${SYNC_START}${HIDE_CURSOR}${next.rows.join("\r\n")}${SYNC_END}`,
    () => restore(terminal, next, position),
  );
}

function write(
  terminal: Terminal,
  written: TerminalRows,
  next: TerminalRows,
): void {
  const before = written.rows;
  const after = next.rows;
  const changed = firstDifference(before, after);
  if (changed === before.length) {
    if (after.length > before.length)
      terminal.write(
        `${before.length > 0 ? "\r\n" : ""}${after.slice(changed).join("\r\n")}`,
      );
    return;
  }
  if (!rewriteTail(terminal, before, after))
    rewriteAll(terminal, written, next);
}

/**
 * Writes the rows into xterm without ever showing an empty terminal (PAGE-289).
 *
 * @param surface - The terminal, once it is loaded.
 * @param next - The rows the terminal should show now.
 * @remarks
 * Rows added at the end are only appended. Changed rows the cursor still
 * reaches, such as the last line of a streamed answer, are redrawn from the
 * first change. Anything else, such as a new width, older entries or a
 * changed earlier line, rewrites the whole text in one synchronized write
 * and keeps the line the reader looks at in place.
 */
export function useTerminalText(
  surface: TerminalSurface | null,
  next: TerminalRows,
): void {
  const written = useRef<WrittenRows>({
    surface: null,
    rows: [],
    lineStarts: [],
  });
  useEffect(() => {
    if (!surface) return;
    const current =
      written.current.surface === surface
        ? written.current
        : { surface, rows: [], lineStarts: [] };
    write(surface.terminal, current, next);
    written.current = { surface, ...next };
  }, [surface, next]);
}

/**
 * The columns the terminal text may fill: one less than xterm has, so xterm
 * never wraps a row itself.
 *
 * @param surface - The terminal, once it is loaded.
 * @returns The columns, or `null` while the terminal is not measured.
 */
export function useTerminalColumns(
  surface: TerminalSurface | null,
): number | null {
  const [columns, setColumns] = useState<number | null>(null);
  useEffect(() => {
    if (!surface) return undefined;
    const { terminal, fit } = surface;
    function measure(): void {
      setColumns(
        fit.proposeDimensions() === undefined
          ? null
          : Math.max(1, terminal.cols - 1),
      );
    }
    measure();
    const resize = terminal.onResize(measure);
    return () => resize.dispose();
  }, [surface]);
  return columns;
}
