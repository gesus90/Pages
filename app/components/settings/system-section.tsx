import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";

/** Renders the placeholder of the system settings that administrators see. */
export function SystemSection(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="mt-10">
      <SettingsSectionHeader
        description={t("settings.system.description")}
        icon={<Server className="size-4" aria-hidden="true" />}
        title={t("settings.system.title")}
      />
      <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.system.placeholder")}
        </p>
      </div>
    </section>
  );
}
