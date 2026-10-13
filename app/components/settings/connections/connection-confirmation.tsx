import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { ConnectionAction } from "./connection-action";

/** Confirms personal credential revocation or rotation with the existing modal pattern. */
export function ConnectionConfirmation({
  action,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly action: ConnectionAction | null;
  readonly pending: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const prefixes = {
    "revoke-token": "settings.connections.revoke",
    "request-rotation": "settings.connections.rotate",
  };
  const prefix = action
    ? prefixes[action.intent]
    : "settings.connections.revoke";
  const destructive = action?.intent !== "request-rotation";
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent size="sm">
        <DialogTitle className="text-lg font-semibold">
          {t(`${prefix}.title`)}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t(`${prefix}.description`, {
            name: action?.name,
          })}
        </DialogDescription>
        {action?.intent === "request-rotation" ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("settings.connections.rotate.hint")}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="pages-selectable mt-4 text-sm text-destructive"
          >
            {t("settings.connections.error.action")}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            {t("settings.connections.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className={destructive ? undefined : "text-foreground"}
            isPending={pending}
            onClick={onConfirm}
          >
            {t(`${prefix}.confirm`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
