import { Bell, MessageCircle, Sparkles, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";

import { ToggleRow } from "./toggle-row";

import type { NotificationChoices } from "@/definition/PicaMobileNotifications";

interface NotificationChoiceSectionProps {
  readonly choices: NotificationChoices;
  readonly onChange: (key: keyof NotificationChoices) => void;
}

function ChoiceCheckbox({
  choiceKey,
  checked,
  disabled,
  onChange,
}: {
  readonly choiceKey: keyof NotificationChoices;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (key: keyof NotificationChoices) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="flex items-start gap-3 rounded-xl px-3 py-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(choiceKey)}
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">
          {t(`settings.notifications.choices.${choiceKey}.title`)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t(`settings.notifications.choices.${choiceKey}.description`)}
        </span>
      </span>
    </label>
  );
}

/** Account choices for chats, Pica and plan runs. */
export function NotificationChoiceSection({
  choices,
  onChange,
}: NotificationChoiceSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const disabled = !choices.receiveNotifications;
  return (
    <div className="flex flex-col gap-1">
      <ToggleRow
        icon={<Bell className="size-4" aria-hidden="true" />}
        title={t("settings.notifications.choices.receiveNotifications.title")}
        description={t(
          "settings.notifications.choices.receiveNotifications.description",
        )}
        checked={choices.receiveNotifications}
        onChange={() => onChange("receiveNotifications")}
      />
      <div className="pl-2">
        <ToggleRow
          icon={<MessageCircle className="size-4" aria-hidden="true" />}
          title={t("settings.notifications.choices.chats.title")}
          description={t("settings.notifications.choices.chats.description")}
          checked={choices.chats}
          disabled={disabled}
          onChange={() => onChange("chats")}
        />
        <ToggleRow
          icon={<Sparkles className="size-4" aria-hidden="true" />}
          title={t("settings.notifications.choices.pica.title")}
          description={t("settings.notifications.choices.pica.description")}
          checked={choices.pica}
          disabled={disabled}
          onChange={() => onChange("pica")}
        />
        <h3 className="px-3 pt-3 text-sm font-semibold text-foreground">
          {t("settings.notifications.choices.plans")}
        </h3>
        <ChoiceCheckbox
          choiceKey="planInterruptions"
          checked={choices.planAllStatuses || choices.planInterruptions}
          disabled={disabled || choices.planAllStatuses}
          onChange={onChange}
        />
        <ChoiceCheckbox
          choiceKey="planCompletions"
          checked={choices.planAllStatuses || choices.planCompletions}
          disabled={disabled || choices.planAllStatuses}
          onChange={onChange}
        />
        <ChoiceCheckbox
          choiceKey="planAllStatuses"
          checked={choices.planAllStatuses}
          disabled={disabled}
          onChange={onChange}
        />
        <div className="flex items-start gap-1 rounded-xl px-1 py-1">
          <Users
            className="mt-3 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex-1">
            <ChoiceCheckbox
              choiceKey="teamRuns"
              checked={choices.teamRuns}
              disabled={disabled}
              onChange={onChange}
            />
          </div>
        </div>
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {t("settings.notifications.choices.visibleChatRule")}
      </p>
    </div>
  );
}
