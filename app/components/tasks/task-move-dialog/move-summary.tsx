import { useTranslation } from "react-i18next";

interface MoveSummaryProps {
  readonly sourceName: string;
  readonly targetName: string;
  readonly droppedEntries: readonly string[];
}

/** Renders where a ticket moves and which relations the move drops. */
export function MoveSummary({
  sourceName,
  targetName,
  droppedEntries,
}: MoveSummaryProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 rounded-xl bg-muted/40 p-4 text-sm">
      <p className="font-semibold text-foreground">
        {sourceName} → {targetName}
      </p>
      {droppedEntries.length > 0 ? (
        <div className="mt-2">
          <p className="text-muted-foreground">{t("tasks.move.droppedHint")}</p>
          <ul className="mt-1 list-disc pl-5 text-foreground">
            {droppedEntries.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">{t("tasks.move.keepsAll")}</p>
      )}
    </div>
  );
}
