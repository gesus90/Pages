import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface LabelSearchFieldProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

/** Renders the search input with a button that clears it. */
export function LabelSearchField({
  query,
  onQueryChange,
}: LabelSearchFieldProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex h-11 items-center gap-2.5 rounded-xl bg-muted/60 pr-2 pl-3.5 outline-none transition-shadow focus-within:bg-muted/80 focus-within:ring-2 focus-within:ring-primary">
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        aria-label={t("tasks.labels.search")}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("tasks.labels.search")}
        value={query}
      />
      {query ? (
        <button
          aria-label={t("tasks.actions.clearSearch")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onQueryChange("")}
          type="button"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
