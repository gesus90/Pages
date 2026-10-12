import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface PanelFooterProps {
  readonly canArchive: boolean;
  readonly canSave: boolean;
  readonly onArchive: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

/** Renders the archive button and the cancel and save buttons of the panel. */
export function PanelFooter({
  canArchive,
  canSave,
  onArchive,
  onCancel,
  onSave,
}: PanelFooterProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-5 pt-3 pb-5">
      {canArchive ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={onArchive}
        >
          <Archive className="size-3.5" aria-hidden="true" />
          {t("projectDetail.planning.phasePlan.archiveMilestone")}
        </button>
      ) : (
        <span />
      )}
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          className="h-10"
          type="button"
          onClick={onCancel}
        >
          {t("projects.actions.cancel")}
        </Button>
        <Button
          className="h-10"
          type="button"
          disabled={!canSave}
          onClick={onSave}
        >
          {t("projects.edit.submit")}
        </Button>
      </div>
    </div>
  );
}
