import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CodeLine } from "./code-view";
import { pairDiffRows, parseUnifiedDiff } from "./diff-lines";
import { highlightLines, resolveSyntaxLanguage } from "./syntax-highlight";

import type { DiffLine, DiffLineKind, ParsedDiff } from "./diff-lines";
import type { SyntaxToken } from "./syntax-highlight";

/** How a diff is laid out: one column, or "vorher" next to "nachher". */
export type DiffLayout = "unified" | "split";

/** The tint of the row of each kind of diff line. */
const ROW_CLASS: Readonly<Record<DiffLineKind, string | undefined>> = {
  added: "bg-diff-added-subtle",
  removed: "bg-diff-removed-subtle",
  context: undefined,
  hunk: "text-muted-foreground",
  meta: "text-muted-foreground",
};

const MARKER: Readonly<Record<DiffLineKind, string>> = {
  added: "+",
  removed: "−",
  context: " ",
  hunk: " ",
  meta: " ",
};

const MARKER_CLASS: Readonly<Record<DiffLineKind, string | undefined>> = {
  added: "text-diff-added",
  removed: "text-diff-removed",
  context: undefined,
  hunk: undefined,
  meta: undefined,
};

/**
 * Parses a unified diff once per text.
 *
 * @param source - The diff.
 * @returns Its lines with the counts of added and removed lines.
 */
export function useParsedDiff(source: string): ParsedDiff {
  return useMemo(() => parseUnifiedDiff(source), [source]);
}

/**
 * The counter `+N −M` of a diff in the colors of added and removed lines.
 *
 * @param diff - The parsed diff.
 */
export function DiffCount({
  diff,
}: {
  readonly diff: Pick<ParsedDiff, "added" | "removed">;
}): React.ReactElement {
  return (
    <span className="font-mono tabular-nums">
      <span className="text-diff-added">+{diff.added}</span>{" "}
      <span className="text-diff-removed">−{diff.removed}</span>
    </span>
  );
}

/** The syntax tokens of a line of the changed file; headers stay plain. */
function tokensOf(line: DiffLine, language: string): readonly SyntaxToken[] {
  if (line.kind === "hunk" || line.kind === "meta")
    return [{ kind: "plain", text: line.text }];
  return highlightLines(line.text, resolveSyntaxLanguage(language))[0] ?? [];
}

interface DiffCellProps {
  readonly line: DiffLine | null;
  /** The file name of the diff; decides the syntax colors of its lines. */
  readonly language: string;
  /** Which line number the cell shows; both for the unified layout. */
  readonly numbers: "old" | "new" | "both";
}

/** One row of a diff: line numbers, the marker and the line in its syntax colors. */
function DiffCell({
  line,
  language,
  numbers,
}: DiffCellProps): React.ReactElement {
  if (line === null) return <div className="bg-muted/40">{"\n"}</div>;
  const number =
    "inline-block w-10 shrink-0 pr-2 text-right text-code-line-number select-none";
  return (
    <div
      className={cn("flex", ROW_CLASS[line.kind])}
      data-diff-line={line.kind}
    >
      {numbers === "new" ? null : (
        <span aria-hidden="true" className={number}>
          {line.oldNumber ?? ""}
        </span>
      )}
      {numbers === "old" ? null : (
        <span aria-hidden="true" className={number}>
          {line.newNumber ?? ""}
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn("w-4 shrink-0 select-none", MARKER_CLASS[line.kind])}
      >
        {MARKER[line.kind]}
      </span>
      <span className="pages-selectable pr-4">
        <CodeLine tokens={tokensOf(line, language)} />
      </span>
    </div>
  );
}

const PRE_CLASS =
  "w-max min-w-full py-2 font-mono text-xs leading-[1.6] text-foreground";

function UnifiedDiff({
  diff,
  language,
}: {
  readonly diff: ParsedDiff;
  readonly language: string;
}): React.ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <pre className={PRE_CLASS}>
        {diff.lines
          .filter((line) => line.kind !== "meta")
          .map((line, index) => (
            <DiffCell
              key={index}
              language={language}
              line={line}
              numbers="both"
            />
          ))}
      </pre>
    </div>
  );
}

/** "vorher" and "nachher" next to each other, row by row. */
function SplitDiff({
  diff,
  language,
}: {
  readonly diff: ParsedDiff;
  readonly language: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const rows = useMemo(() => pairDiffRows(diff.lines), [diff]);
  const sides = [
    { side: "left", numbers: "old", title: t("chatPage.cards.diff.before") },
    { side: "right", numbers: "new", title: t("chatPage.cards.diff.after") },
  ] as const;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border overflow-auto">
      {sides.map(({ side, numbers, title }) => (
        <section
          key={side}
          aria-label={title}
          className="min-w-0 overflow-x-auto"
        >
          <h3 className="sticky top-0 border-b border-border bg-panel-body px-3 py-1.5 text-xs font-normal text-muted-foreground">
            {title}
          </h3>
          <pre className={PRE_CLASS}>
            {rows.map((row, index) => (
              <DiffCell
                key={index}
                language={language}
                line={row[side]}
                numbers={numbers}
              />
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

interface DiffViewProps {
  readonly diff: ParsedDiff;
  readonly layout?: DiffLayout;
  readonly className?: string;
}

/**
 * A unified diff with green added and red removed lines (PAGE-298), below
 * each other or as "vorher" next to "nachher".
 *
 * @remarks
 * The lines keep the syntax colors of the changed file, named by the header
 * of the diff. Rows and markers take the diff tokens of the theme, so a
 * change of theme or design recolors them at once.
 */
export function DiffView({
  diff,
  layout = "unified",
  className,
}: DiffViewProps): React.ReactElement {
  const language = diff.fileName ?? "";
  return (
    <div
      className={cn("flex min-h-0 flex-col bg-panel-body", className)}
      data-diff-layout={layout}
    >
      {layout === "split" ? (
        <SplitDiff diff={diff} language={language} />
      ) : (
        <UnifiedDiff diff={diff} language={language} />
      )}
    </div>
  );
}
