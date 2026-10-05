import {
  AtSign,
  BarChart,
  Bell,
  CalendarDays,
  CheckSquare,
  Mail,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { ToggleRow } from "@/app/components/settings/toggle-row";

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
];

interface NotificationsCardProps {
  readonly notifications: UserSettings["notifications"];
  readonly onToggle: (key: UserNotificationKey) => void;
}

/** Renders one switch per notification channel. */
export function NotificationsCard({
  notifications,
  onToggle,
}: NotificationsCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SettingsCard
      description={t("settings.notifications.description")}
      icon={<Bell className="size-4" aria-hidden="true" />}
      title={t("settings.notifications.title")}
    >
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
      </div>
    </SettingsCard>
  );
}
