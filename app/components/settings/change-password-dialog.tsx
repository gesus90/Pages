import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { PasswordField } from "@/app/components/settings/password/password-field";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { PasswordChangeOutcome } from "@/app/lib/settings-actions/settings-action-support.server";

interface ChangePasswordDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Renders the dialog that changes the password of the signed-in user.
 *
 * @remarks
 * The dialog closes itself once the server accepted the new password and
 * shows the reason when it did not.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: ChangePasswordDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const response = useActionOutcome("change-password");
  const [outcome, setOutcome] = useState<PasswordChangeOutcome | null>(null);
  const lastHandledResponse = useRef<typeof response>(null);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "change-password";

  useEffect(() => {
    if (!open) {
      setOutcome(null);
      return;
    }

    if (response === lastHandledResponse.current) {
      return;
    }

    lastHandledResponse.current = response;

    if (response?.outcome === "success") {
      setOutcome(null);
      onOpenChange(false);
      return;
    }

    if (response) {
      setOutcome(response.outcome);
    }
  }, [open, response, onOpenChange]);

  const errorMessage = outcome
    ? t(`settings.security.password.errors.${outcome}`)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("settings.security.password.dialogTitle")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post">
          <input name="intent" type="hidden" value="change-password" />

          <PasswordField
            autoComplete="current-password"
            id="settings-current-password"
            label={t("settings.security.password.currentPassword")}
            name="currentPassword"
          />
          <PasswordField
            autoComplete="new-password"
            id="settings-new-password"
            label={t("settings.security.password.newPassword")}
            labelClassName="mt-2"
            name="newPassword"
          />
          <PasswordField
            autoComplete="new-password"
            id="settings-password-confirmation"
            label={t("settings.security.password.confirmPassword")}
            labelClassName="mt-2"
            name="passwordConfirmation"
          />

          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("settings.security.password.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("settings.security.password.changing")
                : t("settings.security.password.action")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
