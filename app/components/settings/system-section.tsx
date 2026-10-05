import { Network, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import {
  ControlRow,
  SettingsCard,
  SettingsSectionHeader,
} from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

interface SystemSectionProps {
  /** Port stored in the configuration for the next start. */
  readonly port: number;
}

/**
 * Renders the system settings that administrators see: the server port.
 *
 * @remarks
 * The port is stored in the configuration file and only used after Pages
 * restarts, which the card says next to the field.
 */
export function SystemSection({
  port,
}: SystemSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-port");
  const navigation = useNavigation();
  const isSaving = navigation.formData?.get("intent") === "update-port";
  let message: { readonly text: string; readonly isError: boolean } | null =
    null;

  if (outcome?.ok === true) {
    message = { isError: false, text: t("settings.system.server.saved") };
  } else if (outcome?.ok === false) {
    message = {
      isError: true,
      text: t(`settings.system.server.error.${outcome.error}`),
    };
  }

  return (
    <section className="mt-10">
      <SettingsSectionHeader
        description={t("settings.system.description")}
        icon={<Server className="size-4" aria-hidden="true" />}
        title={t("settings.system.title")}
      />
      <SettingsCard
        className="lg:max-w-[calc(50%-0.5rem)]"
        description={t("settings.system.server.description")}
        icon={<Network className="size-4" aria-hidden="true" />}
        title={t("settings.system.server.title")}
      >
        <Form method="post" noValidate>
          <input type="hidden" name="intent" value="update-port" />
          <ControlRow label={t("settings.system.server.portLabel")}>
            <div className="flex items-center gap-2">
              <Input
                key={outcome?.ok === true ? outcome.port : port}
                aria-label={t("settings.system.server.portLabel")}
                aria-invalid={message?.isError === true ? true : undefined}
                aria-describedby="server-port-hint"
                defaultValue={outcome?.ok === true ? outcome.port : port}
                inputMode="numeric"
                name="port"
              />
              <Button type="submit" disabled={isSaving}>
                {t("settings.system.server.save")}
              </Button>
            </div>
          </ControlRow>
          <p
            className="mt-3 text-xs leading-relaxed text-muted-foreground"
            id="server-port-hint"
          >
            {t("settings.system.server.restartHint")}
          </p>
          {message ? (
            <p
              className={
                message.isError
                  ? "mt-2 text-sm text-destructive"
                  : "mt-2 text-sm text-success"
              }
              role={message.isError ? "alert" : "status"}
            >
              {message.text}
            </p>
          ) : null}
        </Form>
      </SettingsCard>
    </section>
  );
}
