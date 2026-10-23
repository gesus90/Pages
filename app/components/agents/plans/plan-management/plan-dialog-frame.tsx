import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

interface PlanDialogFrameProps {
  readonly title: string;
  /** A short line under the title, such as the source of a copy. */
  readonly description?: string;
  readonly submitLabel: string;
  readonly isPending: boolean;
  readonly isSubmitDisabled: boolean;
  readonly tone?: "default" | "destructive";
  /** A short confirmation has no close button; Cancel and Escape close it. */
  readonly hasCloseButton?: boolean;
  /** The refusal of the last request, as a translated sentence. */
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children?: React.ReactNode;
}

/**
 * The centred modal of the plan menu: title, fields, Cancel and the action.
 *
 * @remarks
 * Nothing happens before the action button: closing, Cancel and Escape
 * leave the plan as it is. While the request runs the dialog stays open and
 * the action cannot be sent twice.
 */
export function PlanDialogFrame(
  props: PlanDialogFrameProps,
): React.ReactElement {
  const { t } = useTranslation();
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!props.isPending && !props.isSubmitDisabled) props.onSubmit();
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !props.isPending) props.onClose();
      }}
    >
      <DialogContent
        size="md"
        // Without a description line the dialog has nothing to be described by.
        {...(props.description ? {} : { "aria-describedby": undefined })}
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <DialogTitle className="text-lg font-semibold">
                {props.title}
              </DialogTitle>
              {props.description ? (
                <DialogDescription className="text-sm text-muted-foreground">
                  {props.description}
                </DialogDescription>
              ) : null}
            </div>
            {props.hasCloseButton === false ? null : (
              <DialogClose asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={props.isPending}
                  aria-label={t("plans.manage.close")}
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </DialogClose>
            )}
          </div>
          {props.children}
          {props.error ? (
            <p role="alert" className="text-sm text-destructive">
              {props.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              disabled={props.isPending}
              onClick={props.onClose}
            >
              {t("settings.agents.cancel")}
            </Button>
            <Button
              type="submit"
              variant={
                props.tone === "destructive" ? "destructive-soft" : "default"
              }
              isPending={props.isPending}
              disabled={props.isSubmitDisabled}
            >
              {props.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
