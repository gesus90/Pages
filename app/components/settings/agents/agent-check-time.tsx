import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { parseInstant } from "@/app/lib/region-format";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const RELATIVE_DAYS = 7;

function relativeParts(
  minutes: number,
): readonly [number, Intl.RelativeTimeFormatUnit] {
  const distance = Math.abs(minutes);
  if (distance < MINUTES_PER_HOUR) return [minutes, "minute"];
  if (distance < MINUTES_PER_DAY)
    return [Math.round(minutes / MINUTES_PER_HOUR), "hour"];
  return [Math.round(minutes / MINUTES_PER_DAY), "day"];
}

/** Shows recent checks relatively, older ones as a date, and preserves the full region-formatted time. */
export function AgentCheckTime({
  checkedAt,
}: {
  readonly checkedAt: string | null;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { formatDate, formatDateTime } = useRegionFormatter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  if (!checkedAt)
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("settings.agents.neverChecked")}</span>
      </>
    );
  const instant = parseInstant(checkedAt);
  const absolute = formatDateTime(checkedAt);
  if (!instant || now === null) return <span>{absolute}</span>;
  const minutes = Math.round((instant.getTime() - now) / 60000);
  const label =
    Math.abs(minutes) < RELATIVE_DAYS * MINUTES_PER_DAY
      ? new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(
          ...relativeParts(minutes),
        )
      : formatDate(checkedAt);
  return (
    <time dateTime={instant.toISOString()} title={absolute}>
      {label}
    </time>
  );
}
