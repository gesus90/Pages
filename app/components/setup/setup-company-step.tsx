import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AuthField } from "@/app/components/auth/auth-field";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import { MAXIMUM_COMPANY_NAME_LENGTH } from "@/definition/Setup";

import { describeSetupFieldError } from "./setup-field-error";
import { SetupStepActions } from "./setup-step-actions";
import { SetupStepForm } from "./setup-step-form";

import type { SetupDraft } from "./use-setup-draft";

interface SetupCompanyStepProps {
  readonly draft: SetupDraft;
}

/** Renders the wizard step that asks for the company name. */
export function SetupCompanyStep({
  draft,
}: SetupCompanyStepProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SetupStepForm
      title={t("setup.company.title")}
      subtitle={t("setup.company.subtitle")}
      onSubmit={draft.goForward}
    >
      <AuthField
        ref={focusOnMount}
        className="mt-8"
        name="companyName"
        label={t("setup.company.label")}
        placeholder={t("setup.company.placeholder")}
        icon={Building2}
        autoComplete="organization"
        maxLength={MAXIMUM_COMPANY_NAME_LENGTH}
        required
        value={draft.values.companyName}
        onChange={(event) => draft.setField("companyName", event.target.value)}
        error={describeSetupFieldError(t, draft.fieldErrors.companyName)}
      />
      <SetupStepActions submitLabel={t("setup.next")} onBack={draft.goBack} />
    </SetupStepForm>
  );
}
