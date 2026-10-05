import { StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";

interface GeneralNotesSectionProps {
  readonly notes: string;
}

/** Renders the project notes or a hint that there are none yet. */
export function GeneralNotesSection({
  notes,
}: GeneralNotesSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <h2 className="select-none font-semibold text-foreground">
        {t("projectDetail.general.notes")}
      </h2>
      {notes ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {notes}
        </p>
      ) : (
        <div className="mt-3 flex flex-col items-center py-4 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <StickyNote className="size-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("projectDetail.general.noNotes")}
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("projectDetail.general.notesEmptyHint")}
          </p>
        </div>
      )}
    </section>
  );
}
