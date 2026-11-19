import {
  AtSign,
  BarChart,
  Bell,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  Mail,
  Monitor,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { ToggleRow } from "@/app/components/settings/toggle-row";
import { Select } from "@/app/components/ui/select";
import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";

import { NotificationChoiceSection } from "./notification-choice-section";

import type { AutomationNotificationMode } from "@/definition/Automation";
import type { NotificationChoices } from "@/definition/PicaMobileNotifications";
import type { UserNotificationKey, UserSettings } from "@/definition/Settings";
import type { ReactNode } from "react";

const NOTIFICATION_ITEMS: readonly {
  readonly key: UserNotificationKey;
  readonly icon: ReactNode;
}[] = [
  {
    key: "email",
    icon: <Mail className="size-4" aria-hidden="true" />,
  },
  {
    key: "desktop",
    icon: <Monitor className="size-4" aria-hidden="true" />,
  },
  {
    key: "mentions",
    icon: <AtSign className="size-4" aria-hidden="true" />,
  },
  {
    key: "assignments",
    icon: <CheckSquare className="size-4" aria-hidden="true" />,
  },
  {
    key: "dueDates",
    icon: <CalendarDays className="size-4" aria-hidden="true" />,
  },
  {
    key: "weeklySummary",
    icon: <BarChart className="size-4" aria-hidden="true" />,
  },
  {
    key: "calendarInvitations",
    icon: <CalendarPlus className="size-4" aria-hidden="true" />,
  },
];

interface NotificationsCardProps {
  readonly notifications: UserSettings["notifications"];
  readonly onToggle: (key: UserNotificationKey) => void;
  readonly choices: NotificationChoices;
  readonly onChoiceChange: (key: keyof NotificationChoices) => void;
  /** When the person hears about runs of their automations. */
  readonly automationNotification: AutomationNotificationMode;
  readonly onAutomationNotificationChange: (
    mode: AutomationNotificationMode,
  ) => void;
}

interface AutomationNotificationRowProps {
  readonly mode: AutomationNotificationMode;
  readonly onChange: (mode: AutomationNotificationMode) => void;
}

function AutomationNotificationRow({
  mode,
  onChange,
}: AutomationNotificationRowProps): React.ReactElement {
  const { t } = useTranslation();
  const options = AUTOMATION_NOTIFICATION_MODES.map((value) => ({
    value,
    label: t(`settings.notifications.automations.modes.${value}`),
  }));

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Workflow className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {t("settings.notifications.automations.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.notifications.automations.description")}
        </p>
      </div>
      <Select
        size="sm"
        className="w-36"
        value={mode}
        onValueChange={onChange}
        options={options}
        ariaLabel={t("settings.notifications.automations.title")}
      />
    </div>
  );
}

/** Renders one switch per notification channel. */
export function NotificationsCard({
  notifications,
  onToggle,
  choices,
  onChoiceChange,
  automationNotification,
  onAutomationNotificationChange,
}: NotificationsCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SettingsCard
      description={t("settings.notifications.description")}
      icon={<Bell className="size-4" aria-hidden="true" />}
      title={t("settings.notifications.title")}
    >
      <NotificationChoiceSection choices={choices} onChange={onChoiceChange} />
      <h3 className="px-3 pt-4 text-sm font-semibold text-foreground">
        {t("settings.notifications.choices.more")}
      </h3>
      <p className="mb-3 rounded-xl bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {t("settings.notifications.deliveryPending")}
      </p>
      <div className="flex flex-col gap-1">
        {NOTIFICATION_ITEMS.map((item) => (
          <ToggleRow
            checked={notifications[item.key]}
            description={t(`settings.notifications.${item.key}.description`)}
            icon={item.icon}
            key={item.key}
            onChange={() => onToggle(item.key)}
            title={t(`settings.notifications.${item.key}.title`)}
          />
        ))}
        <AutomationNotificationRow
          mode={automationNotification}
          onChange={onAutomationNotificationChange}
        />
      </div>
    </SettingsCard>
  );
}
