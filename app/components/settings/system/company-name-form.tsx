import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { ControlRow } from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { MAXIMUM_COMPANY_NAME_LENGTH } from "@/definition/Setup";

interface CompanyNameFormProps {
  /** Name stored for the instance. */
  readonly companyName: string;
}

/** Changes the company name that the navigation and the login page show. */
export function CompanyNameForm({
  companyName,
}: CompanyNameFormProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-company-name");
  const navigation = useNavigation();
  const isSaving = navigation.formData?.get("intent") === "update-company-name";

  return (
    <Form method="post" noValidate>
      <input type="hidden" name="intent" value="update-company-name" />
      <ControlRow label={t("settings.system.instance.companyName")}>
        <div className="flex items-center gap-2">
          <Input
            key={companyName}
            aria-invalid={outcome?.ok === false ? true : undefined}
            aria-label={t("settings.system.instance.companyName")}
            defaultValue={companyName}
            maxLength={MAXIMUM_COMPANY_NAME_LENGTH}
            name="companyName"
          />
          <Button type="submit" disabled={isSaving}>
            {t("settings.system.instance.save")}
          </Button>
        </div>
      </ControlRow>
      {outcome?.ok === true ? (
        <p className="mt-2 text-sm text-success" role="status">
          {t("settings.system.instance.nameSaved")}
        </p>
      ) : null}
      {outcome?.ok === false ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t(`settings.system.instance.nameError.${outcome.error}`)}
        </p>
      ) : null}
    </Form>
  );
}
