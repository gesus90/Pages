import { useTranslation } from "react-i18next";

import { PlanRecoveryRestart } from "./plan-recovery/plan-recovery-restart";
import { PlanRecoveryState } from "./plan-recovery/plan-recovery-state";

import type { TFunction } from "i18next";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";
import type { PlanRecoveryRequest, usePlanRecovery } from "./use-plan-recovery";

const RECOVERABLE_STATUSES = new Set(["failed", "cancelled", "stopping"]);
const ACCESS_ERRORS = new Set(["access_denied", "plan_access_denied"]);

/** The newest run when it ended and may be restarted or resumed, else `null`. */
export function recoverableRunId(
  control: AgentPlanControl | undefined,
): string | null {
  return control?.runId && RECOVERABLE_STATUSES.has(control.status)
    ? control.runId
    : null;
}

/** The translated reason of a refused recovery request. */
export function recoveryErrorText(
  translate: TFunction,
  code: string,
  failure?: AgentPlanCleanupFailure | null,
  stepNames?: Readonly<Record<string, string>>,
): string {
  const message = translate([
    `plans.recovery.error.${code}`,
    `settings.agents.error.${code}`,
    "plans.panel.error",
  ]);
  if (code !== "cleanup_unconfirmed" || !failure) return message;
  const detail = translate(`plans.recovery.cleanupFailure.${failure.reason}`, {
    step: stepNames?.[failure.stepId] ?? failure.stepId,
    resource: translate(`plans.recovery.cleanupKind.${failure.kind}`),
  });
  return `${message} ${detail}`;
}

/**
 * What the executor can do with a run that failed or was stopped: see its
 * state, failure point and last verified checkpoint, or start the plan again
 * from the start.
 *
 * @remarks
 * Shared readers and other users never see it; the server answers only the
 * executor of the run with its current rights. Continuing from the last safe
 * state is the Fortsetzen button of the panel; why it is not available is
 * listed here.
 */
export function PlanRecoveryPanel({
  runId,
  recovery,
}: {
  readonly runId: string | null;
  readonly recovery: ReturnType<typeof usePlanRecovery>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = recovery;
  if (!runId) return null;
  // Another person's run is not theirs to recover; the server says so without details.
  if (!view)
    return recovery.error && !ACCESS_ERRORS.has(recovery.error) ? (
      <p role="alert" className="text-xs text-destructive">
        {recoveryErrorText(t, recovery.error)}
      </p>
    ) : null;
  function submit(request: PlanRecoveryRequest): void {
    void recovery.submit(request);
  }
  return (
    <section
      aria-label={t("plans.recovery.title")}
      aria-busy={recovery.isPending}
      className="space-y-2 text-xs leading-4 wrap-anywhere text-muted-foreground"
    >
      <h3 className="text-xs font-semibold text-foreground">
        {t("plans.recovery.title")}
      </h3>
      <PlanRecoveryState view={view} />
      {view.blockers.length > 0 ? (
        <ul className="list-inside list-disc">
          {view.blockers.map((blocker) => (
            <li key={blocker}>{t(`plans.recovery.blocker.${blocker}`)}</li>
          ))}
        </ul>
      ) : null}
      <PlanRecoveryRestart
        view={view}
        isPending={recovery.isPending}
        onSubmit={submit}
      />
      {recovery.result ? (
        <p role="status">
          {t(`plans.recovery.result.${recovery.result.outcome}`)}
        </p>
      ) : null}
      {recovery.error ? (
        <p role="alert" className="text-destructive">
          {recoveryErrorText(
            t,
            recovery.error,
            recovery.cleanupFailure,
            view.stepNames,
          )}
        </p>
      ) : null}
    </section>
  );
}
