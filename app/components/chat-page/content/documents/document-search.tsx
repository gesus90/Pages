import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CardAction } from "../content-card";

import type { CardTone } from "../content-card";

interface DocumentSearchProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** Matches found; `null` hides the count, such as while a search runs. */
  readonly matchCount: number | null;
  /** The match shown, from 0. */
  readonly current?: number;
  /** Offers the previous and next match. */
  readonly onStep?: (direction: number) => void;
  readonly tone?: CardTone;
  readonly className?: string;
}

/**
 * The search of a document, slides, a table or a PDF (PAGE-385): a field,
 * the number of matches and, where it helps, the previous and next match.
 * Enter jumps to the next one.
 */
export function DocumentSearch({
  query,
  onQuery,
  matchCount,
  current = 0,
  onStep,
  tone = "light",
  className,
}: DocumentSearchProps): React.ReactElement {
  const { t } = useTranslation();
  const isDark = tone === "dark";
  const hasMatches = matchCount !== null && matchCount > 0;

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter" || !onStep) return;
    event.preventDefault();
    onStep(event.shiftKey ? -1 : 1);
  }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-1", className)}
      role="search"
    >
      <label
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 text-xs",
          isDark
            ? "border-viewer-edge bg-viewer-control text-viewer-foreground"
            : "border-border bg-surface text-foreground",
        )}
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        <span className="sr-only">{t("chatPage.cards.document.search")}</span>
        <input
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chatPage.cards.document.searchPlaceholder")}
          type="search"
          value={query}
        />
      </label>
      {query.trim() !== "" && matchCount !== null ? (
        <span
          aria-live="polite"
          className={cn(
            "shrink-0 text-xs tabular-nums",
            isDark ? "text-viewer-muted" : "text-muted-foreground",
          )}
        >
          {hasMatches
            ? t("chatPage.cards.document.matchOf", {
                current: current + 1,
                count: matchCount,
              })
            : t("chatPage.cards.document.noMatch")}
        </span>
      ) : null}
      {onStep && hasMatches ? (
        <>
          <CardAction
            icon={ChevronUp}
            isIconOnly
            label={t("chatPage.cards.document.previousMatch")}
            onClick={() => onStep(-1)}
            tone={tone}
            variant="quiet"
          />
          <CardAction
            icon={ChevronDown}
            isIconOnly
            label={t("chatPage.cards.document.nextMatch")}
            onClick={() => onStep(1)}
            tone={tone}
            variant="quiet"
          />
        </>
      ) : null}
    </div>
  );
}
