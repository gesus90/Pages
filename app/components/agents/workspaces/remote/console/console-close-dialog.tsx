import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

/** Confirms that closing the panel terminates its remote shell, or the running setup. */
export function ConsoleCloseDialog(props: {
  readonly hostName: string;
  readonly isSetup: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** Where the focus goes when the console stays open. */
  readonly onReturnFocus: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent
        size="md"
        // The confirmation also dims the console panel behind it.
        overlayClassName="z-50"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onReturnFocus();
        }}
      >
        <DialogTitle className="text-lg font-semibold">
          {t(
            props.isSetup
              ? "remote.setup.closeTitle"
              : "remote.console.closeTitle",
            { name: props.hostName },
          )}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t(
            props.isSetup
              ? "remote.setup.closeDescription"
              : "remote.console.closeDescription",
          )}
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
