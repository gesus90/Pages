import { LockKeyhole, Mail, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AuthField } from "@/app/components/auth/auth-field";
import { PasswordVisibilityToggle } from "@/app/components/auth/password-visibility-toggle";
import { usePasswordVisibility } from "@/app/components/auth/use-password-visibility";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import {
  MAXIMUM_EMAIL_LENGTH,
  MAXIMUM_PASSWORD_LENGTH,
  MAXIMUM_USERNAME_LENGTH,
} from "@/definition/Setup";

import { describeSetupFieldError } from "./setup-field-error";
import { SetupStepActions } from "./setup-step-actions";
import { SetupStepForm } from "./setup-step-form";

import type { SetupDraft } from "./use-setup-draft";

interface SetupAdministratorStepProps {
  readonly draft: SetupDraft;
}

/** Renders the wizard step that asks for the main administrator account. */
export function SetupAdministratorStep({
  draft,
}: SetupAdministratorStepProps): React.ReactElement {
  const { t } = useTranslation();
  const { isPasswordVisible, togglePasswordVisibility } =
    usePasswordVisibility("password");

  return (
    <SetupStepForm
      title={t("setup.administrator.title")}
      subtitle={t("setup.administrator.subtitle")}
      onSubmit={draft.goForward}
    >
      <AuthField
        ref={focusOnMount}
        className="mt-8"
        name="username"
        label={t("setup.administrator.username")}
        placeholder={t("setup.administrator.usernamePlaceholder")}
        icon={UserRound}
        autoComplete="username"
        maxLength={MAXIMUM_USERNAME_LENGTH}
        required
        value={draft.values.username}
        onChange={(event) => draft.setField("username", event.target.value)}
        error={describeSetupFieldError(t, draft.fieldErrors.username)}
      />
      <AuthField
        className="mt-5"
        name="password"
        label={t("setup.administrator.password")}
        placeholder={t("setup.administrator.passwordPlaceholder")}
        icon={LockKeyhole}
        type={isPasswordVisible ? "text" : "password"}
        autoComplete="new-password"
        maxLength={MAXIMUM_PASSWORD_LENGTH}
        required
        value={draft.values.password}
        onChange={(event) => draft.setField("password", event.target.value)}
        error={describeSetupFieldError(t, draft.fieldErrors.password)}
      >
        <PasswordVisibilityToggle
          isPasswordVisible={isPasswordVisible}
          onToggle={togglePasswordVisibility}
        />
      </AuthField>
      <AuthField
        className="mt-5"
        name="email"
        label={t("setup.administrator.email")}
        placeholder={t("setup.administrator.emailPlaceholder")}
        icon={Mail}
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={MAXIMUM_EMAIL_LENGTH}
        value={draft.values.email}
        onChange={(event) => draft.setField("email", event.target.value)}
        error={describeSetupFieldError(t, draft.fieldErrors.email)}
      />
      <SetupStepActions submitLabel={t("setup.next")} onBack={draft.goBack} />
    </SetupStepForm>
  );
}
