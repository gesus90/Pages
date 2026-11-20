import { renderTerminal } from "./terminal-lines";
import { plainText } from "./terminal-tools";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";
import type { TerminalTexts } from "./terminal-lines";

/** The columns of the miniature: 372 px of terminal at 13 px monospace. */
const PREVIEW_COLUMNS = 46;

/** The newest rows the miniature shows: 172 px of 21 px rows. */
const PREVIEW_ROWS = 9;

interface Segment {
  readonly text: string;
  readonly className: string;
}

const COLOR_CLASSES: Readonly<Record<string, string>> = {
  "97": "text-agent-terminal-strong",
  "90": "text-agent-terminal-muted",
  "36": "text-agent-terminal-cyan",
  "32": "text-agent-terminal-success",
  "31": "text-agent-terminal-error",
  "33": "text-agent-terminal-warning",
  "35": "text-agent-terminal-accent",
};

/** The classes of one escape sequence of the terminal, which sets its whole style. */
function styleClass(codes: string): string {
  const classes: string[] = [];
  for (const code of codes.split(";")) {
    const color = COLOR_CLASSES[code];
    if (code === "1") classes.push("font-bold");
    else if (code === "3") classes.push("italic");
    else if (color) classes.push(color);
  }
  return classes.join(" ");
}

/** Splits a terminal row into text pieces, each with the classes of its colors. */
function rowSegments(row: string): readonly Segment[] {
  const segments: Segment[] = [];
  let className = "";
  let position = 0;
  for (const match of row.matchAll(/\u001b\[([0-9;]*)m/gu)) {
    if (match.index > position)
      segments.push({ text: row.slice(position, match.index), className });
    className = styleClass(match[1] ?? "");
    position = match.index + match[0].length;
  }
  if (position < row.length)
    segments.push({ text: row.slice(position), className });
  return segments;
}

/**
 * The rows of the terminal for the events of a session, without its start line.
 * @param events - The newest events of the session.
 * @param texts - The words of the terminal, the same the terminal itself uses.
 * @remarks
 * They come from the same renderer as the terminal, so the miniature shows
 * nothing the terminal does not show.
 */
export function previewRows(
  events: readonly AgentSessionEvent[],
  texts: TerminalTexts,
): readonly string[] {
  if (events.length === 0) return [];
  const { rows, lineStarts } = renderTerminal({
    provider: "",
    model: "",
    prompt: null,
    attempts: [
      {
        number: 1,
        startedAt: events[0]?.createdAt ?? null,
        events,
        ending: null,
      },
    ],
    todoTexts: new Map(),
    columns: PREVIEW_COLUMNS,
    texts,
    expandedCalls: new Set(),
  });
  // The first line is the start line of the attempt, which the card names itself.
  return rows.slice(lineStarts[1] ?? rows.length);
}

/**
 * The last line of the rows as plain text for a spoken name, without time or mark.
 * @param rows - The rows of {@link previewRows}.
 * @returns The text, or `null` when nothing is written yet.
 */
export function lastPreviewLine(rows: readonly string[]): string | null {
  for (const row of rows.toReversed()) {
    const text = plainText(row)
      .replace(/^\s*\d{2}:\d{2}:\d{2}\s+/u, "")
      .replace(/^[✓✕▸☐↻]\s*/u, "")
      .trim();
    if (text !== "") return text;
  }
  return null;
}

/**
 * The terminal of a session as a 186 × 88 px miniature at half scale.
 * @remarks
 * It is the same text as the terminal, drawn small, never a picture. The
 * newest rows stand at the bottom and the top fades out. It is hidden from
 * assistive technology; the card names session, state and last line. A new
 * text fades in within 150 ms at the same place, so nothing jumps.
 */
export function SwarmSessionPreview(props: {
  readonly rows: readonly string[];
}): React.ReactElement {
  const visible = props.rows.slice(-PREVIEW_ROWS);
  return (
    <div
      aria-hidden="true"
      className="relative h-[88px] w-[186px] shrink-0 overflow-hidden rounded-lg border border-border bg-agent-terminal-surface"
    >
      <div
        key={visible.join("\n")}
        className="absolute bottom-0 left-0 w-[372px] origin-bottom-left scale-50 font-mono text-[13px] leading-[21px] whitespace-pre motion-safe:animate-swarm-preview-in"
      >
        {visible.map((row, index) => (
          <div
            key={`${String(index)}:${row}`}
            className="h-[21px] overflow-hidden"
          >
            {rowSegments(row).map((segment, position) => (
              <span key={position} className={segment.className}>
                {segment.text}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18px] bg-linear-to-b from-agent-terminal-surface to-transparent" />
    </div>
  );
}
