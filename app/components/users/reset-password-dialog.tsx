import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  useIsSubmitting,
  useUsersActionData,
} from "@/app/components/users/use-users-action";

import type { UserListItem } from "@/definition/User";

interface CopyButtonProps {
  readonly value: string;
}

/** Renders a button that copies a value and confirms it for two seconds. */
function CopyButton({ value }: CopyButtonProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(): void {
    if (!navigator.clipboard) {
      return;
    }

    navigator.clipboard
      .writeText(value)
      .then(() => {
        setIsCopied(true);
      })
      .catch(() => {
        setIsCopied(false);
      });
  }

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCopied]);

  return (
    <Button
      className="h-9 shrink-0 gap-1.5 px-3 text-xs"
      onClick={handleCopy}
      type="button"
      variant="outline"
    >
      {isCopied ? (
        <Check className="size-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {isCopied ? t("users.reset.copied") : t("users.reset.copy")}
    </Button>
  );
}

interface ResetPasswordDialogProps {
  readonly user: UserListItem;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Renders the dialog that resets a password and shows the temporary one once. */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: ResetPasswordDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const isSubmitting = useIsSubmitting("reset-password");

  const temporaryPassword =
    actionData?.intent === "reset-password" &&
    actionData.ok &&
    actionData.userId === user.id
      ? actionData.temporaryPassword
      : null;

  useEffect(() => {
    if (temporaryPassword) {
      setShownPassword(temporaryPassword);
    }
  }, [temporaryPassword]);

  // The menu opens the dialog, so Radix only ever asks to close it.
  function handleClose(): void {
    setShownPassword(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {shownPassword
            ? t("users.reset.resultTitle")
            : t("users.reset.title")}
        </DialogTitle>

        {shownPassword ? (
          <div className="mt-5 flex flex-col gap-3">
            <label
              className="select-none text-sm font-medium text-foreground"
              htmlFor={`temporary-password-${user.id}`}
            >
              {t("users.reset.temporaryPassword")}
            </label>
            <div className="flex items-center gap-2">
              <p
                id={`temporary-password-${user.id}`}
                className="min-w-0 flex-1 truncate rounded-xl bg-muted px-4 py-3 font-mono text-sm font-semibold text-foreground"
              >
                {shownPassword}
              </p>
              <CopyButton value={shownPassword} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("users.reset.emailHint")}
            </p>
            <div className="mt-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button">{t("users.reset.close")}</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <Form className="mt-5 flex flex-col gap-3" method="post">
            <input name="intent" type="hidden" value="reset-password" />
            <input name="userId" type="hidden" value={user.id} />

            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("users.reset.text")}
            </p>

            <div className="mt-2 flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {t("users.reset.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("users.reset.resetting")
                  : t("users.reset.confirm")}
              </Button>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
