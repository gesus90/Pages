import { useTranslation } from "react-i18next";

import {
  PLAN_MAXIMUM_RETRIES,
  PLAN_SESSION_MAXIMUM_ATTEMPTS,
} from "@/definition/AgentPlanRetry";

import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";
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
  const policy = retry.policy ?? "provider";
  const isSessionPolicy = policy === "session";
  const maximum = isSessionPolicy
    ? PLAN_SESSION_MAXIMUM_ATTEMPTS
    : PLAN_MAXIMUM_RETRIES;
  const failedAttempts = Math.min(retry.attempts.length, maximum);
  const reason =
    isSessionPolicy && retry.reason === "exhausted"
      ? "sessionExhausted"
      : retry.reason;
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
            : `plans.retry.reason.${reason}`,
        )}
      </p>
      <p>
        {isSessionPolicy
          ? t(sessionAttemptKey(retry.state), {
              attempt:
                retry.state === "blocked" || retry.state === "waiting"
                  ? failedAttempts
                  : Math.min(failedAttempts + 1, maximum),
              failed: failedAttempts,
              next: Math.min(failedAttempts + 1, maximum),
              maximum,
            })
          : t("plans.retry.count", {
              count: failedAttempts,
              maximum,
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

/** One key per persisted session-retry state, so a blocked attempt never promises a successor. */
function sessionAttemptKey(state: AgentPlanRetry["state"]): string {
  if (state === "waiting") return "plans.retry.sessionWaiting";
  if (state === "running") return "plans.retry.sessionRunning";
  if (state === "completed") return "plans.retry.sessionCompleted";
  return "plans.retry.sessionBlocked";
}
