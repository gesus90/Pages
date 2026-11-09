import { useTranslation } from "react-i18next";

import { AgentCheckTime } from "../agent-check-time";

import type { AcpLeaseCheckSummary } from "@/definition/AcpResource";

/** Shows the last and next periodic reservation check and what it found. */
export function AcpLeaseCheckStatus({
  check,
}: {
  readonly check: AcpLeaseCheckSummary | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!check) return null;
  const isFailed = check.outcome === "failed";
  return (
    <section
      aria-label={t("settings.agents.resources.check.title", {
        minutes: check.intervalMinutes,
      })}
      className="space-y-1 rounded-md border border-border p-3"
    >
      <p className="font-medium">
        {t("settings.agents.resources.check.title", {
          minutes: check.intervalMinutes,
        })}
      </p>
      <p className="text-muted-foreground">
        {t("settings.agents.resources.check.last")}{" "}
        {check.lastAt ? (
          <AgentCheckTime checkedAt={check.lastAt} />
        ) : (
          t("settings.agents.resources.check.never")
        )}{" "}
        · {t("settings.agents.resources.check.next")}{" "}
        {check.nextAt ? (
          <AgentCheckTime checkedAt={check.nextAt} />
        ) : (
          t("settings.agents.resources.check.running")
        )}
      </p>
      <p
        role={isFailed ? "alert" : "status"}
        className={isFailed ? "text-destructive" : undefined}
      >
        {t(`settings.agents.resources.check.outcome.${check.outcome}`, {
          checked: check.checked,
          released: check.released,
          unconfirmed: check.unconfirmed,
          failed: check.failed,
        })}
      </p>
      {check.scope === "all" ? null : (
        <p className="text-muted-foreground">
          {t(`settings.agents.resources.check.scope.${check.scope}`)}
        </p>
      )}
    </section>
  );
}
