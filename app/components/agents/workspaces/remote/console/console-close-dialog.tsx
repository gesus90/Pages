import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

/** Confirms that closing the panel terminates its remote shell. */
export function ConsoleCloseDialog(props: {
  readonly workspaceName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("remote.console.closeTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("remote.console.closeDescription", { name: props.workspaceName })}
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel}>
            {t("remote.console.returnToConsole")}
          </Button>
          <Button variant="destructive" onClick={props.onConfirm}>
            {t("remote.console.endSession")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
