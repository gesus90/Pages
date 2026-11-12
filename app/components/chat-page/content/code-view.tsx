import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { highlightLines, resolveSyntaxLanguage } from "./syntax-highlight";

import type { SyntaxToken, SyntaxTokenKind } from "./syntax-highlight";

/** The theme token of each kind of syntax token; plain text keeps the text color. */
const TOKEN_CLASS: Readonly<Record<SyntaxTokenKind, string | undefined>> = {
  keyword: "text-code-keyword",
  function: "text-code-function",
  string: "text-code-string",
  number: "text-code-number",
  comment: "text-code-comment italic",
  plain: undefined,
};

/** Lines an expanded code card shows before "Alle Zeilen zeigen". */
export const CODE_PREVIEW_LINES = 20;

/**
 * The tokens of one line of code in their syntax colors.
 *
 * @param tokens - The tokens of the line; an empty line keeps its height.
 */
export function CodeLine({
  tokens,
}: {
  readonly tokens: readonly SyntaxToken[];
}): React.ReactElement {
  if (tokens.length === 0) return <>{"\n"}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
      {"\n"}
    </>
  );
}

/**
 * Splits code into lines of syntax tokens, once per text and language.
 *
 * @param source - The code.
 * @param languageHint - The info of the fence or the file name; an unknown
 * language yields plain lines.
 */
export function useHighlightedLines(
  source: string,
  languageHint: string,
): SyntaxToken[][] {
  return useMemo(
    () => highlightLines(source, resolveSyntaxLanguage(languageHint)),
    [source, languageHint],
  );
}

interface CodeViewProps {
  readonly source: string;
  /** The info of the code fence or the file name; decides the syntax colors. */
  readonly languageHint: string;
  /** Shows only the first 20 lines with a control that shows all of them. */
  readonly isPreview?: boolean;
  readonly className?: string;
}

/**
 * Code with line numbers and syntax colors on the code surface (PAGE-298).
 *
 * @remarks
 * Every color is a theme token, so a change of theme or design recolors the
 * code at once. An unknown language shows without colors but with line
 * numbers. Long lines scroll sideways; the text can be selected.
 */
export function CodeView({
  source,
  languageHint,
  isPreview = false,
  className,
}: CodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const [isAll, setAll] = useState(false);
  const lines = useHighlightedLines(source, languageHint);
  const isCut = isPreview && !isAll && lines.length > CODE_PREVIEW_LINES;
  const shown = isCut ? lines.slice(0, CODE_PREVIEW_LINES) : lines;

  return (
    <div className={cn("flex min-h-0 flex-col bg-panel-body", className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="flex w-max min-w-full py-2.5 font-mono text-xs leading-[1.6] text-foreground">
          <span
            aria-hidden="true"
            className="sticky left-0 shrink-0 bg-panel-body pr-3 pl-3 text-right text-code-line-number select-none"
          >
            {shown.map((tokens, index) => `${String(index + 1)}\n`)}
          </span>
          <code className="pages-selectable block pr-4" data-code-lines="">
            {shown.map((tokens, index) => (
              <CodeLine key={index} tokens={tokens} />
            ))}
          </code>
        </pre>
      </div>
      {isCut ? (
        <button
          className="border-t border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setAll(true)}
          type="button"
        >
          {t("chatPage.cards.showAllLines", { count: lines.length })}
        </button>
      ) : null}
    </div>
  );
}
