import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { LogoForm } from "@/app/components/settings/system/logo-form";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { MAXIMUM_COMPANY_NAME_LENGTH } from "@/definition/Setup";

import type { InstanceBranding } from "@/definition/Instance";

interface InstanceCardProps {
  readonly branding: InstanceBranding;
}

interface CompanyNameFormProps {
  readonly companyName: string;
}

function CompanyNameForm({
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

/** Changes company name and logo, which the navigation and the login page show. */
export function InstanceCard({
  branding,
}: InstanceCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SettingsCard
      description={t("settings.system.instance.description")}
      icon={<Building2 className="size-4" aria-hidden="true" />}
      title={t("settings.system.instance.title")}
    >
      <div className="flex flex-col gap-6">
        <CompanyNameForm companyName={branding.companyName ?? ""} />
        <LogoForm logoUrl={branding.logoUrl} />
      </div>
    </SettingsCard>
  );
}
