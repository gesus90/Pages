import { useTranslation } from "react-i18next";
import { Form, Link, useNavigation } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { CHAT_LIMITS } from "@/definition/Chat";

import picaIconUrl from "@/assets/pica-icon.svg";

import type { ChatAdministration } from "@/definition/Chat";

interface ChatSettingsCardProps {
  readonly settings: ChatAdministration;
}

/**
 * Attachment limit and system instruction of the chat agent Pica (T6.12.4,
 * T6.12.8); access and model are chosen in the agents panel (T6.12.14).
 */
export function ChatSettingsCard({
  settings,
}: ChatSettingsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-chat-settings");
  const navigation = useNavigation();
  const isSaving =
    navigation.formData?.get("intent") === "update-chat-settings";

  return (
    <SettingsCard
      description={t("settings.system.chat.description")}
      icon={<img alt="" className="size-5" src={picaIconUrl} />}
      title={t("settings.system.chat.title")}
    >
      <Form className="space-y-3" method="post" noValidate>
        <input name="intent" type="hidden" value="update-chat-settings" />
        <ControlRow label={t("settings.system.chat.attachmentLimit")}>
          <Input
            key={settings.attachmentLimitMegabytes}
            aria-label={t("settings.system.chat.attachmentLimit")}
            defaultValue={settings.attachmentLimitMegabytes}
            inputMode="numeric"
            name="attachmentLimitMegabytes"
          />
        </ControlRow>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.system.chat.attachmentHint")}
        </p>
        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">
            {t("settings.system.chat.instruction")}
          </span>
          <Textarea
            key={settings.systemInstruction}
            className="min-h-64 font-mono text-xs"
            defaultValue={settings.systemInstruction}
            maxLength={CHAT_LIMITS.instructionCharacters}
            name="systemInstruction"
          />
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {settings.isDefaultInstruction
            ? t("settings.system.chat.instructionDefault")
            : t("settings.system.chat.instructionCustom")}{" "}
          {t("settings.system.chat.instructionHint")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.system.chat.modelHint")}{" "}
          <Link className="text-primary underline" to="/settings/agents">
            {t("settings.system.chat.modelLink")}
          </Link>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isSaving} type="submit">
            {t("settings.system.chat.save")}
          </Button>
          {settings.isDefaultInstruction ? null : (
            <Button
              disabled={isSaving}
              name="resetInstruction"
              type="submit"
              value="true"
              variant="outline"
            >
              {t("settings.system.chat.reset")}
            </Button>
          )}
        </div>
        {outcome?.ok === true ? (
          <p className="text-sm text-success" role="status">
            {t("settings.system.chat.saved")}
          </p>
        ) : null}
        {outcome?.ok === false ? (
          <p className="text-sm text-destructive" role="alert">
            {t(`settings.system.chat.error.${outcome.error}`)}
          </p>
        ) : null}
      </Form>
    </SettingsCard>
  );
}
