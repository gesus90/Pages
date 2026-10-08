import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";

interface WikiActionDialogProps {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  /** Path of the route whose action handles the form. */
  readonly action: string;
  /** Hidden fields sent with the form, among them the intent. */
  readonly fields: Readonly<Record<string, string>>;
  readonly isDestructive?: boolean;
  readonly size?: "sm" | "md" | "lg";
  readonly onClose: () => void;
  /** Inputs of the form besides the hidden fields. */
  readonly children?: React.ReactNode;
}

/**
 * A dialog that sends one wiki action and closes when it succeeded.
 *
 * @remarks
 * An action that redirects, such as deleting a page, leaves the page the
 * dialog belongs to; the dialog goes with it.
 */
export function WikiActionDialog({
  title,
  description,
  submitLabel,
  action,
  fields,
  isDestructive = false,
  size = "sm",
  onClose,
  children,
}: WikiActionDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<WikiActionResult>();
  const result = fetcher.data;
  const hasSucceeded = result?.ok === true;

  useEffect(() => {
    if (hasSucceeded) {
      onClose();
    }
  }, [hasSucceeded, onClose]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size={size}>
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        <fetcher.Form action={action} className="mt-4 space-y-4" method="post">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          {children}
          {result?.ok === false ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`wiki.errors.${result.error}`)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("wiki.dialog.cancel")}
            </Button>
            <Button
              isPending={fetcher.state !== "idle"}
              type="submit"
              variant={isDestructive ? "destructive" : "default"}
            >
              {submitLabel}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
