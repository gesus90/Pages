import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

interface PanelArchiveDialogProps {
  readonly open: boolean;
  readonly milestoneName: string;
  readonly linkCount: number;
  readonly isArchiving: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/**
 * Renders the confirmation for archiving a milestone.
 *
 * @remarks
 * It names the milestone and what the archive does: the milestone is kept but
 * leaves the plan, its status stays, its dependency links are removed, and the
 * tickets assigned to it are not archived with it. Cancelling changes nothing.
 */
export function PanelArchiveDialog({
  open,
  milestoneName,
  linkCount,
  isArchiving,
  onOpenChange,
  onConfirm,
}: PanelArchiveDialogProps): React.ReactElement {
  const { t } = useTranslation();

  function handleCancel(): void {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(26rem,92vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.planning.phasePlan.archiveTitle", {
            name: milestoneName,
          })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.planning.phasePlan.archiveDescription", {
            name: milestoneName,
          })}
        </DialogDescription>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-foreground">
          <li>{t("projectDetail.planning.phasePlan.archiveTicketsHint")}</li>
          {linkCount > 0 ? (
            <li>
              {t("projectDetail.planning.phasePlan.archiveLinksHint", {
                count: linkCount,
              })}
            </li>
          ) : null}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={handleCancel}>
            {t("projects.actions.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            type="button"
            disabled={isArchiving}
            onClick={onConfirm}
          >
            {t("projectDetail.planning.phasePlan.archiveConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
