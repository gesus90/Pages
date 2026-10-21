import { useTranslation } from "react-i18next";

import { PLAN_MAXIMUM_RETRIES } from "@/definition/AgentPlanRetry";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Shows persisted attempts and the actual retry deadline; a missing reset never promises automatic progress. */
export function PlanStatusRetry({
  session,
}: {
  readonly session: AgentPlanSessionRecord;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const retry = session.retry;
  if (!retry) return null;
  const formatTime = (instant: string): string =>
    new Date(instant).toLocaleString(i18n.resolvedLanguage);
  const attempt = retry.attempts.at(-1);
  return (
    <section
      role="status"
      className="mb-3 space-y-1 rounded-md border border-border bg-muted/50 p-2 text-xs leading-4.5 wrap-anywhere"
    >
      <h4 className="font-semibold">{t(`plans.retry.state.${retry.state}`)}</h4>
      <p>
        {t(
          retry.state === "completed"
            ? "plans.retry.completedHint"
            : `plans.retry.reason.${retry.reason}`,
        )}
      </p>
      <p>
        {t("plans.retry.count", {
          count: Math.min(retry.attempts.length, PLAN_MAXIMUM_RETRIES),
          maximum: PLAN_MAXIMUM_RETRIES,
        })}
      </p>
      {attempt ? (
        <p>
          {t("plans.retry.lastCause", {
            cause: t(`settings.agents.error.${attempt.code}`),
          })}
        </p>
      ) : null}
      {retry.resetAt ? (
        <p>{t("plans.retry.resetAt", { time: formatTime(retry.resetAt) })}</p>
      ) : null}
      {retry.nextAttemptAt ? (
        <p>
          {t("plans.retry.nextAt", { time: formatTime(retry.nextAttemptAt) })}
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">
          {t("plans.retry.history")}
        </summary>
        <ol className="mt-1 list-inside list-decimal space-y-1">
          {retry.attempts.map((entry, index) => (
            <li key={entry.attemptId ?? index}>
              {formatTime(entry.endedAt)} ·{" "}
              {t(`settings.agents.error.${entry.code}`)}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
