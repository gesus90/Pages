import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

interface PanelDeleteDialogProps {
  readonly open: boolean;
  readonly milestoneName: string;
  readonly linkCount: number;
  readonly isDeleting: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/** Renders the confirmation for deleting a milestone together with its links. */
export function PanelDeleteDialog({
  open,
  milestoneName,
  linkCount,
  isDeleting,
  onOpenChange,
  onConfirm,
}: PanelDeleteDialogProps): React.ReactElement {
  const { t } = useTranslation();

  function handleCancel(): void {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(26rem,92vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.planning.phasePlan.deleteTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.planning.phasePlan.deleteDescription", {
            name: milestoneName,
          })}
          {linkCount > 0
            ? ` ${t("projectDetail.planning.phasePlan.deleteLinksHint")}`
            : ""}
        </DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={handleCancel}>
            {t("projects.actions.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {t("projectDetail.planning.phasePlan.deleteConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
