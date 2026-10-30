import { useTranslation } from "react-i18next";

import type { TFunction } from "i18next";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";
import type { usePlanRecovery } from "./use-plan-recovery";

const RECOVERABLE_STATUSES = new Set([
  "running",
  "pausing",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "stopping",
]);
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

/** Legacy diagnostic projection; regular recovery actions belong exclusively to the upper controls. */
export function PlanRecoveryPanel(props: {
  readonly runId: string | null;
  readonly recovery: ReturnType<typeof usePlanRecovery>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const error = props.recovery.error;
  if (!props.runId || !error || ACCESS_ERRORS.has(error)) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {recoveryErrorText(t, error)}
    </p>
  );
}
