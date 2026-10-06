import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { TemporaryPasswordResult } from "@/app/components/users/temporary-password-result";
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
          <TemporaryPasswordResult
            password={shownPassword}
            onClose={handleClose}
          />
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
