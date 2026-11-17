import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

interface PlanJumpDialogShellProps {
  /** Names the dialog for the page, such as `jump` or `signal`. */
  readonly name: string;
  readonly title: React.ReactNode;
  readonly description: string;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  /** Whether the settings are complete and valid enough to apply. */
  readonly canApply: boolean;
  readonly onApply: () => void;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/**
 * The frame of the settings dialogs of the Jump family: title, hint, the fields and the apply and cancel buttons.
 * @remarks
 * Edits stay private until Apply; closing or cancelling discards them.
 */
export function PlanJumpDialogShell(
  props: PlanJumpDialogShellProps,
): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-transparent"
        size="md"
        className="space-y-4 overflow-y-auto"
        data-plan-dialog={props.name}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClose();
        }}
      >
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          {props.title}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {props.description}
        </DialogDescription>
        {props.children}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            {t("settings.agents.cancel")}
          </Button>
          {props.isDisabled ? null : (
            <Button
              size="sm"
              disabled={!props.canApply}
              onClick={props.onApply}
            >
              {t("plans.closeNode")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
