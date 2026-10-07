import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { CompanyNameForm } from "@/app/components/settings/system/company-name-form";
import { LogoForm } from "@/app/components/settings/system/logo-form";

import type { InstanceBranding } from "@/definition/Instance";

interface InstanceCardProps {
  readonly branding: InstanceBranding;
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
