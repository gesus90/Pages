import { cn } from "@/app/lib/cn";

import type { DocumentRun } from "./document-model";

/** Schemes a link of a document may have to be offered as a link; anything else stays text. */
const LINK_SCHEMES: readonly string[] = ["http:", "https:", "mailto:"];

/**
 * The address of a link of a document, when it may be offered.
 *
 * @param target - The target the file names.
 * @returns The address for http, https and mailto, else `null`.
 */
export function safeLinkOf(target: string): string | null {
  try {
    const url = new URL(target);
    return LINK_SCHEMES.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Splits text at every match of a search, regardless of case.
 *
 * @param text - The text.
 * @param query - The search; empty keeps the text whole.
 * @returns The pieces, each marked whether it matches.
 */
export function splitMatches(
  text: string,
  query: string,
): { readonly text: string; readonly isMatch: boolean }[] {
  const search = query.trim().toLocaleLowerCase();
  if (search === "") return [{ text, isMatch: false }];
  const lower = text.toLocaleLowerCase();
  const pieces: { text: string; isMatch: boolean }[] = [];
  let index = 0;
  for (
    let found = lower.indexOf(search);
    found >= 0;
    found = lower.indexOf(search, index)
  ) {
    if (found > index)
      pieces.push({ text: text.slice(index, found), isMatch: false });
    pieces.push({
      text: text.slice(found, found + search.length),
      isMatch: true,
    });
    index = found + search.length;
  }
  if (index < text.length)
    pieces.push({ text: text.slice(index), isMatch: false });
  return pieces;
}

/** Text with its matches of the search marked in the accent color. */
export function MarkedText({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): React.ReactElement {
  return (
    <>
      {splitMatches(text, query).map((piece, index) =>
        piece.isMatch ? (
          <mark
            key={index}
            className="rounded-sm bg-primary-subtle text-primary"
            data-search-match=""
          >
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )}
    </>
  );
}

/** One run of a document with its emphasis; a link is offered, never followed by itself. */
function Run({
  run,
  query,
}: {
  readonly run: DocumentRun;
  readonly query: string;
}): React.ReactElement {
  const className = cn(
    run.isBold && "font-semibold",
    run.isItalic && "italic",
    run.isUnderline && "underline",
    run.isStrike && "line-through",
  );
  const content = <MarkedText query={query} text={run.text} />;
  const href = run.link === undefined ? null : safeLinkOf(run.link);
  if (href !== null)
    return (
      <a
        className={cn(className, "text-primary underline underline-offset-2")}
        href={href}
        referrerPolicy="no-referrer"
        rel="noopener noreferrer nofollow"
        target="_blank"
        title={href}
      >
        {content}
      </a>
    );
  return className === "" ? (
    content
  ) : (
    <span className={className}>{content}</span>
  );
}

/**
 * The runs of a paragraph, heading, list item or cell as text with emphasis
 * (PAGE-385); line breaks and tabs of the file stay.
 */
export function DocumentRuns({
  runs,
  query = "",
}: {
  readonly runs: readonly DocumentRun[];
  readonly query?: string;
}): React.ReactElement {
  return (
    <>
      {runs.map((run, index) => (
        <Run key={index} query={query} run={run} />
      ))}
    </>
  );
}
