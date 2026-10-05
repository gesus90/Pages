import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { LoginField } from "@/app/components/login/login-field";
import { PasswordVisibilityToggle } from "@/app/components/login/password-visibility-toggle";
import { usePasswordVisibility } from "@/app/components/login/use-password-visibility";
import { Button } from "@/app/components/ui/button";

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
      <LoginField
        name="username"
        label={t("login.username")}
        icon={UserRound}
        type="text"
        autoComplete="username"
        inputClassName="h-12 rounded-xl border border-[#e5e8ee] bg-[#f8f9fb] pr-4 pl-12 text-base hover:border-[#d3d8e0] focus-visible:border-primary sm:h-14 xl:h-14 xl:pr-4 xl:pl-12 xl:text-base"
      />

      <LoginField
        className="mt-5"
        name="password"
        label={t("login.password")}
        icon={LockKeyhole}
        type={isPasswordVisible ? "text" : "password"}
        autoComplete="current-password"
        inputClassName="h-12 rounded-xl border border-[#e5e8ee] bg-[#f8f9fb] pr-14 pl-12 text-base hover:border-[#d3d8e0] focus-visible:border-primary sm:h-14 xl:h-14 xl:pr-14 xl:pl-12 xl:text-base"
      >
        <PasswordVisibilityToggle
          isPasswordVisible={isPasswordVisible}
          onToggle={togglePasswordVisibility}
        />
      </LoginField>

      <div className="mt-3 min-h-6" aria-live="polite">
        {error ? (
          <p className="text-sm leading-relaxed text-destructive" role="alert">
            {t(`login.error.${error}`)}
          </p>
        ) : null}
      </div>

      <Button
        className="relative mt-6 h-12 w-full rounded-xl bg-gradient-to-r from-[#ffa25e] to-primary px-6 text-base font-semibold text-primary-foreground shadow-[0_10px_24px_-8px_rgb(249_115_22/45%)] transition-all hover:-translate-y-[1px] hover:brightness-[1.04] active:translate-y-0 active:brightness-95 sm:h-14 xl:h-14 xl:text-base"
        type="submit"
        disabled={isSubmitting}
      >
        <span className="mx-auto">
          {isSubmitting ? t("login.submitting") : t("login.submit")}
        </span>
        <ArrowRight
          className="pointer-events-none absolute top-1/2 right-6 size-5 -translate-y-1/2"
          aria-hidden="true"
        />
      </Button>
    </Form>
  );
}
