import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import { EMOJI_CATEGORIES, searchEmoji } from "@/app/lib/editor/emoji-catalog";

import type { EmojiEntry } from "@/app/lib/editor/emoji-catalog";

/** Columns of the emoji grid; arrow keys move by one cell or one row. */
const COLUMNS = 8;

interface EmojiPickerProps {
  readonly onPick: (emoji: string) => void;
  /** Shows a button that removes the current choice. */
  readonly onRemove?: () => void;
}

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: COLUMNS,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
};

/** Moves the focus through the grid with the arrow keys. */
function handleGridKey(event: React.KeyboardEvent<HTMLElement>): void {
  const step = ARROW_STEPS[event.key];
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-emoji]",
    ),
  ];
  const index = buttons.findIndex(
    (button) => button === document.activeElement,
  );

  if (step === undefined || index < 0) {
    return;
  }

  event.preventDefault();
  buttons[Math.min(Math.max(index + step, 0), buttons.length - 1)]?.focus();
}

function EmojiGrid({
  entries,
  onPick,
}: {
  readonly entries: readonly EmojiEntry[];
  readonly onPick: (emoji: string) => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-8 gap-0.5" onKeyDown={handleGridKey}>
      {entries.map((entry) => (
        <button
          key={entry.emoji}
          aria-label={entry.emoji}
          className="flex size-8 items-center justify-center rounded-md text-xl hover:bg-muted focus-visible:bg-muted"
          data-emoji={entry.emoji}
          title={entry.keywords.split(" ")[0]}
          type="button"
          onClick={() => onPick(entry.emoji)}
        >
          {entry.emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * Lets a person choose an emoji: a search over English and German words and
 * the emoji grouped by category. Used for page icons and inside the text.
 */
export function EmojiPicker({
  onPick,
  onRemove,
}: EmojiPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const results = searchEmoji(query);
  const isSearching = query.trim() !== "";

  return (
    <div className="flex w-72 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("editor.emoji.search")}
          autoFocus
          placeholder={t("editor.emoji.search")}
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {onRemove ? (
          <button
            className="h-9 shrink-0 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
            type="button"
            onClick={onRemove}
          >
            {t("editor.emoji.remove")}
          </button>
        ) : null}
      </div>
      <div
        className={cn("max-h-64 overflow-y-auto pr-1", "pages-thin-scrollbar")}
      >
        {isSearching ? (
          <EmojiGrid entries={results} onPick={onPick} />
        ) : (
          EMOJI_CATEGORIES.map((category) => (
            <section
              key={category}
              aria-label={t(`editor.emoji.categories.${category}`)}
            >
              <h3 className="px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(`editor.emoji.categories.${category}`)}
              </h3>
              <EmojiGrid
                entries={results.filter((entry) => entry.category === category)}
                onPick={onPick}
              />
            </section>
          ))
        )}
        {results.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground" role="status">
            {t("editor.emoji.empty")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
