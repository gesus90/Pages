import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { PicaMobileAddressField } from "./pica-mobile-address-field";
import { PicaMobilePortField } from "./pica-mobile-port-field";
import { usePicaMobilePort } from "./use-pica-mobile-port";

import type { PicaMobileSettingsView } from "@/definition/PicaMobile";

/** Lets an administrator choose the WebSocket port of Pica Mobile and shows the address for the app. */
export function PicaMobileCard({
  settings,
}: {
  readonly settings: PicaMobileSettingsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = usePicaMobilePort(settings);
  const inactiveError =
    settings.isListening || form.error !== null ? null : settings.listenError;

  return (
    <SettingsCard
      icon={<Smartphone className="size-4" />}
      title={t("settings.connections.picaMobile.title")}
      description={t("settings.connections.picaMobile.description")}
      wrapHeader
      action={
        <span className="inline-flex min-h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-foreground shadow-xs">
          {t("settings.connections.picaMobile.adminOnly")}
        </span>
      }
    >
      <form
        onSubmit={form.submit}
        noValidate
        className="grid gap-x-6 gap-y-5 lg:grid-cols-[11rem_minmax(0,1fr)]"
      >
        <PicaMobilePortField form={form} />
        <PicaMobileAddressField
          address={form.address}
          hasHost={settings.host !== null}
        />
        {inactiveError ? (
          <p
            role="status"
            className="pages-selectable text-sm text-destructive lg:col-span-2"
          >
            {t("settings.connections.picaMobile.inactive")}{" "}
            {t(`settings.connections.picaMobile.error.${inactiveError}`, {
              port: settings.port,
            })}
          </p>
        ) : null}
        <div className="flex justify-end lg:col-span-2">
          <Button
            type="submit"
            isPending={form.pending}
            disabled={!form.canSave}
          >
            {t("settings.connections.picaMobile.save")}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
