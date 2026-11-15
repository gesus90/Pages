import { useTranslation } from "react-i18next";

import { useRegionFormat } from "@/app/components/common/region-provider";

import type { DashboardBuild } from "@/definition/SystemDashboard";

interface VersionFactProps {
  readonly version: string;
  readonly build: DashboardBuild | null;
}

function formatBuildDate(
  builtAt: string,
  language: string,
  timeZone: string,
): string {
  const instant = new Date(builtAt);
  const date = new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(instant);
  const time = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(instant);
  return `${date} ${time}`;
}

/**
 * Shows the deployed build beside the version, in the visitor's language and time zone.
 *
 * @remarks
 * "Version · Build <commit>" and "· <date time>" each stay together in a
 * `whitespace-nowrap` span. When the column is too narrow, the line breaks
 * only between these two parts, never inside one. The build carries the full
 * commit as tooltip.
 */
export function VersionFact({
  version,
  build,
}: VersionFactProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { timeZone } = useRegionFormat();
  const unknown = t("settings.system.dashboard.facts.unknown");
  const commit = build?.commit.slice(0, 8) ?? unknown;
  const builtAt = build
    ? formatBuildDate(build.builtAt, i18n.language, timeZone)
    : unknown;

  return (
    <>
      <span className="whitespace-nowrap">
        {version} ·{" "}
        <span title={build?.commit}>
          {t("settings.system.dashboard.facts.build", { commit })}
        </span>
      </span>{" "}
      <span className="whitespace-nowrap">· {builtAt}</span>
    </>
  );
}
