import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { AgentCheckTime } from "@/app/components/settings/agents/agent-check-time";

/** Formats a timestamp with an exact accessible tooltip and relative recent times. */
export function ConnectionTime({
  time,
  unlimited = false,
}: {
  readonly time: number | null;
  readonly unlimited?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  if (time === null)
    return <span>{unlimited ? t("mcpDuration.unlimited") : "—"}</span>;
  const timestamp = new Date(time).toISOString();
  if (!unlimited) return <AgentCheckTime checkedAt={timestamp} />;
  const label = formatDateTime(timestamp);
  return (
    <time dateTime={timestamp} title={label}>
      {label}
    </time>
  );
}
