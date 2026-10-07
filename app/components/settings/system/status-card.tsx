import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import {
  ProfileRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";

import type { ServerStatus } from "@/backend/service/ServerSettingsService";

interface StatusCardProps {
  readonly status: ServerStatus;
}

/** Shows version, database file, and start time of the running instance. */
export function StatusCard({ status }: StatusCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();

  return (
    <SettingsCard
      description={t("settings.system.status.description")}
      icon={<Activity className="size-4" aria-hidden="true" />}
      title={t("settings.system.status.title")}
    >
      <dl className="flex flex-col gap-3">
        <ProfileRow label={t("settings.system.status.version")}>
          {status.version}
        </ProfileRow>
        <ProfileRow label={t("settings.system.status.databasePath")}>
          <span className="break-all">
            {status.databasePath ?? t("settings.system.status.unknown")}
          </span>
        </ProfileRow>
        <ProfileRow label={t("settings.system.status.startedAt")}>
          {formatDateTime(status.startedAt)}
        </ProfileRow>
      </dl>
    </SettingsCard>
  );
}
