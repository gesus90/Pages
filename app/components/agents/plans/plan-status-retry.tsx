import { useTranslation } from "react-i18next";

import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import type {
  AgentPlanBlockerClass,
  AgentPlanFailureStop,
  AgentPlanRetry,
  AgentPlanRetryAttempt,
} from "@/definition/AgentPlanRetry";
import type { AgentPlanRun } from "@/definition/AgentPlan";
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
  const failureClass = retryClass(retry, attempt);
  const maximum = PLAN_BLOCKER_RETRIES[failureClass] + 1;
  const failedAttempts = Math.min(
    retry.attempts.filter(
      (entry) => (entry.failureClass ?? "infrastructure") === failureClass,
    ).length,
    maximum,
  );
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
      <p>{t(`plans.retry.class.${failureClass}`)}</p>
      <p>
        {t(attemptKey(retry.state), {
          attempt:
            retry.state === "blocked" || retry.state === "waiting"
              ? failedAttempts
              : Math.min(failedAttempts + 1, maximum),
          failed: failedAttempts,
          next: Math.min(failedAttempts + 1, maximum),
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

/** The class of a record; one written before the classes held only technical failures. */
function retryClass(
  retry: AgentPlanRetry,
  attempt: AgentPlanRetryAttempt | undefined,
): AgentPlanBlockerClass {
  return retry.failureClass ?? attempt?.failureClass ?? "infrastructure";
}

/** One key per persisted retry state, so a blocked attempt never promises a successor. */
function attemptKey(state: AgentPlanRetry["state"]): string {
  if (state === "waiting") return "plans.retry.attemptWaiting";
  if (state === "running") return "plans.retry.attemptRunning";
  if (state === "completed") return "plans.retry.attemptCompleted";
  return "plans.retry.attemptBlocked";
}

/** Says why a failed node stopped, for every node, also one without a retry record. */
export function PlanStatusStop({
  stop,
}: {
  readonly stop: AgentPlanFailureStop | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!stop) return null;
  return (
    <p className="text-xs leading-4.5 text-destructive wrap-anywhere">
      {t("plans.retry.stop", {
        failureClass: t(`plans.retry.class.${stop.failureClass}`),
        attempts: stop.attempts,
        maximum: stop.maximumAttempts,
      })}
    </p>
  );
}

/** Says whether a run a server restart interrupted continues on its own, and why not. */
export function PlanAutomaticResumeNote({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const resume = run?.recovery?.automaticResume;
  if (!resume) return null;
  return (
    <p className="mb-2 text-xs leading-4.5 text-muted-foreground wrap-anywhere">
      {t(`plans.retry.automaticResume.${resume.state}`, {
        reason: resume.reason
          ? t([
              `plans.recovery.blocker.${resume.reason}`,
              `plans.retry.automaticResume.reason.${resume.reason}`,
              `settings.agents.error.${resume.reason}`,
              "plans.retry.automaticResume.reason.other",
            ])
          : "",
      })}
    </p>
  );
}
