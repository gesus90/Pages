import { LockKeyhole, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { AuthField } from "@/app/components/auth/auth-field";
import { AuthSubmitButton } from "@/app/components/auth/auth-submit-button";
import { PasswordVisibilityToggle } from "@/app/components/auth/password-visibility-toggle";
import { usePasswordVisibility } from "@/app/components/auth/use-password-visibility";

/** Why a sign-in attempt was rejected. */
export type LoginFormError = "invalidCredentials" | "tooManyAttempts";

interface LoginFormProps {
  /** The reason of the last rejected attempt, or `undefined` before one. */
  readonly error: LoginFormError | undefined;
  readonly isSubmitting: boolean;
}

/** Renders the credential fields, the rejection message and the submit button. */
export function LoginForm({
  error,
  isSubmitting,
}: LoginFormProps): React.ReactElement {
  const { t } = useTranslation();
  const { isPasswordVisible, togglePasswordVisibility } =
    usePasswordVisibility("password");

  return (
    <Form className="mt-8 flex flex-col" method="post" noValidate>
      <AuthField
        name="username"
        label={t("login.username")}
        placeholder={t("login.username")}
        icon={UserRound}
        type="text"
        autoComplete="username"
        required
      />

      <AuthField
        className="mt-5"
        name="password"
        label={t("login.password")}
        placeholder={t("login.password")}
        icon={LockKeyhole}
        type={isPasswordVisible ? "text" : "password"}
        autoComplete="current-password"
        required
      >
        <PasswordVisibilityToggle
          isPasswordVisible={isPasswordVisible}
          onToggle={togglePasswordVisibility}
        />
      </AuthField>

      <div className="mt-3 min-h-6" aria-live="polite">
        {error ? (
          <p
            className="pages-selectable text-sm leading-relaxed text-destructive"
            role="alert"
          >
            {t(`login.error.${error}`)}
          </p>
        ) : null}
      </div>

      <AuthSubmitButton
        className="mt-6"
        label={t("login.submit")}
        pendingLabel={t("login.submitting")}
        isPending={isSubmitting}
      />
    </Form>
  );
}
