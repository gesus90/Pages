import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import type {
  AgentCheckDetail,
  AgentCheckKind,
  AgentCheckSummary,
} from "@/definition/AgentConnection";

function DetailValue({
  value,
}: {
  readonly value: unknown;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (typeof value === "boolean")
    return <>{t(value ? "settings.agents.yes" : "settings.agents.no")}</>;
  if (typeof value === "number")
    return (
      <>
        {new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 6,
        }).format(value)}
      </>
    );
  return <>{String(value)}</>;
}

function CheckDetails({
  detail,
}: {
  readonly detail: AgentCheckDetail;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(detail).map(([key, value]: [string, unknown]) => (
        <div key={key} className="contents">
          <dt>{t(`settings.agents.detail.${key}`)}</dt>
          <dd className="pages-selectable break-words">
            <DetailValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// CLI checks read the local login status and run the CLI, so they are named like their buttons.
const HEADINGS = {
  api: { auth: "auth", model: "model" },
  cli: { auth: "cliAuth", model: "cliModel" },
} as const;

/** Shows separate, timestamped access and model evidence with sanitized details only. */
export function AgentCheckResults({
  kind,
  check,
  isCli,
}: {
  readonly kind: AgentCheckKind;
  readonly check: AgentCheckSummary | null;
  readonly isCli: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
      <h4 className="font-medium">
        {t(
          `settings.agents.checkKind.${HEADINGS[isCli ? "cli" : "api"][kind]}`,
        )}
      </h4>
      {!check ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.neverChecked")}
        </p>
      ) : (
        <>
          <p
            className={
              check.status === "passed" ? "text-success" : "text-destructive"
            }
          >
            {t(`settings.agents.result.${check.status}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(check.checkedAt)} ·{" "}
            {t("settings.agents.duration", { duration: check.durationMs })}
          </p>
          {check.errorCode ? (
            <p role="alert" className="text-xs text-destructive">
              {t(`settings.agents.error.${check.errorCode}`)}
            </p>
          ) : null}
          <CheckDetails detail={check.detail} />
        </>
      )}
    </div>
  );
}
