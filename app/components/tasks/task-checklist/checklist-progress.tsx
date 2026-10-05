import { useTranslation } from "react-i18next";

interface ChecklistProgressProps {
  readonly doneCount: number;
  readonly totalCount: number;
}

/** Renders the progress bar with the done counter, or a hint without items. */
export function ChecklistProgress({
  doneCount,
  totalCount,
}: ChecklistProgressProps): React.ReactElement {
  const { t } = useTranslation();

  if (totalCount === 0) {
    return <p className="text-xs text-muted-foreground">{t("tasks.none")}</p>;
  }

  const progress = Math.round((doneCount / totalCount) * 100);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="shrink-0 font-medium text-foreground">
        {doneCount} / {totalCount}
      </span>
    </div>
  );
}
