import { Link as LinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Renders the placeholder shown while a ticket has no links. */
export function LinkEmptyState(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl bg-muted/40 px-4 py-5 text-center">
      <LinkIcon
        className="size-4 text-muted-foreground/70"
        aria-hidden="true"
      />
      <p className="text-xs font-medium text-foreground">
        {t("tasks.links.none")}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("tasks.links.emptyHint")}
      </p>
    </div>
  );
}
