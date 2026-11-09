import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { FormError } from "@/app/components/users/form-error";

import type { UsersErrorCode } from "@/app/lib/user-actions/user-action-support.server";

interface AgentTemplateConfirmProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly isDestructive: boolean;
  readonly isPending?: boolean;
  readonly error?: UsersErrorCode | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Asks before a template is deleted or replaces the text of `AGENT.md`
 * (PAGE-283), in the confirmation dialog of the user administration.
 */
export function AgentTemplateConfirm({
  title,
  description,
  confirmLabel,
  isDestructive,
  isPending = false,
  error = null,
  onConfirm,
  onCancel,
}: AgentTemplateConfirmProps): React.ReactElement {
  const { t } = useTranslation();
  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onCancel();
  }
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {description}
        </DialogDescription>
        <div className="mt-3">
          <FormError error={error} />
        </div>
        <footer className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">
              {t("agentEmployees.templateList.editor.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            isPending={isPending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
