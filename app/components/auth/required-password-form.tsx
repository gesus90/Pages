import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { AuthField } from "@/app/components/auth/auth-field";
import { AuthSubmitButton } from "@/app/components/auth/auth-submit-button";
import { Button } from "@/app/components/ui/button";

import type { PasswordChangeOutcome } from "@/app/lib/settings-actions/settings-action-support.server";

const PASSWORD_FIELDS = [
  {
    name: "currentPassword",
    label: "currentPassword",
    autoComplete: "current-password",
  },
  { name: "newPassword", label: "newPassword", autoComplete: "new-password" },
  {
    name: "passwordConfirmation",
    label: "confirmPassword",
    autoComplete: "new-password",
  },
] as const;

interface RequiredPasswordFormProps {
  readonly outcome: PasswordChangeOutcome | undefined;
  readonly isSubmitting: boolean;
}

/** Collects a replacement password and offers logout without granting workspace access. */
export function RequiredPasswordForm({
  outcome,
  isSubmitting,
}: RequiredPasswordFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <Form className="mt-6 flex flex-col gap-4" method="post" noValidate>
        {PASSWORD_FIELDS.map((field) => (
          <AuthField
            key={field.name}
            name={field.name}
            label={t(`settings.security.password.${field.label}`)}
            icon={LockKeyhole}
            type="password"
            autoComplete={field.autoComplete}
            required
          />
        ))}
        {outcome && outcome !== "success" ? (
          <p className="pages-selectable text-sm text-destructive" role="alert">
            {t(`settings.security.password.errors.${outcome}`)}
          </p>
        ) : null}
        <AuthSubmitButton
          label={t("settings.security.password.action")}
          pendingLabel={t("settings.security.password.changing")}
          isPending={isSubmitting}
        />
      </Form>
      <Form className="mt-4" action="/logout" method="post">
        <Button type="submit" variant="ghost">
          {t("account.signOut")}
        </Button>
      </Form>
    </>
  );
}
