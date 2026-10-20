import { useTranslation } from "react-i18next";

import { PlanRecoveryRestart } from "./plan-recovery/plan-recovery-restart";
import { PlanRecoveryResume } from "./plan-recovery/plan-recovery-resume";
import { PlanRecoveryState } from "./plan-recovery/plan-recovery-state";
import { usePlanRecovery } from "./use-plan-recovery";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanRecoveryRequest } from "./use-plan-recovery";

const RECOVERABLE_STATUSES = new Set(["failed", "cancelled"]);
const ACCESS_ERRORS = new Set(["access_denied", "plan_access_denied"]);

function recoveryErrorText(
  translate: ReturnType<typeof useTranslation>["t"],
  code: string,
): string {
  return translate([
    `plans.recovery.error.${code}`,
    `settings.agents.error.${code}`,
    "plans.panel.error",
  ]);
}

/**
 * What the executor can do with a run that failed or was stopped: see its
 * state, failure point and last verified checkpoint, start the plan again
 * from the start, or continue from the last safe state.
 *
 * @remarks
 * Shared readers and other users never see it; the server answers only the
 * executor of the run with its current rights.
 */
export function PlanRecoveryPanel({
  control,
  onRunStarted,
}: {
  readonly control: AgentPlanControl | undefined;
  readonly onRunStarted: (runId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const runId =
    control?.runId && RECOVERABLE_STATUSES.has(control.status)
      ? control.runId
      : null;
  const recovery = usePlanRecovery(runId, onRunStarted);
  const { view } = recovery;
  if (!runId) return null;
  // Another person's run is not theirs to recover; the server says so without details.
  if (!view)
    return recovery.error && !ACCESS_ERRORS.has(recovery.error) ? (
      <p
        role="alert"
        className="border-t border-border px-2.5 py-2 text-xs text-destructive"
      >
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
      className="space-y-2 border-t border-border px-2.5 py-2 text-xs leading-4 wrap-anywhere text-muted-foreground"
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
      <PlanRecoveryResume
        view={view}
        isPending={recovery.isPending}
        onSubmit={submit}
      />
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
          {recoveryErrorText(t, recovery.error)}
        </p>
      ) : null}
    </section>
  );
}
