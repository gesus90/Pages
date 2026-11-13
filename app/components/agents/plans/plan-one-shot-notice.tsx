import { Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useRevalidator } from "react-router";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/** The label of a one-time plan next to its name in the plan header (PAGE-309). */
export function PlanOneShotBadge({
  className,
}: {
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning",
        className,
      )}
    >
      <Timer aria-hidden="true" className="size-3" />
      {t("plans.manage.oneShotBadge")}
    </span>
  );
}

/** The local time of day a deletion is scheduled for, or `null` for an unreadable time. */
function deletionTime(
  scheduledDeletionAt: string,
  language: string,
): string | null {
  const time = new Date(scheduledDeletionAt);
  if (Number.isNaN(time.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

/** How long after the deadline the page reads again, so the deletion has finished. */
const REFRESH_GRACE_MILLISECONDS = 3_000;

/**
 * Reloads the plan when its deadline appears or passes, so the header follows without a manual reload.
 *
 * @remarks
 * The deadline is set by the server when a run ends as `succeeded`, so the
 * page reads again once the polled control leaves an active status; it reads
 * once more shortly after the deadline, when the plan is gone.
 */
function usePlanDeadlineRefresh(
  plan: AgentPlanView,
  status: AgentPlanControl["status"] | undefined,
): void {
  const revalidator = useRevalidator();
  const previous = useRef(status);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (plan.oneShot && before && isActivePlanRun(before) && status !== before)
      void revalidator.revalidate();
  }, [plan.oneShot, status, revalidator]);
  const deadline = plan.scheduledDeletionAt;
  useEffect(() => {
    if (!deadline) return;
    const wait = new Date(deadline).getTime() - Date.now();
    if (!Number.isFinite(wait)) return;
    const timer = setTimeout(
      () => void revalidator.revalidate(),
      Math.max(wait, 0) + REFRESH_GRACE_MILLISECONDS,
    );
    return () => clearTimeout(timer);
  }, [deadline, revalidator]);
}

/**
 * Says when Pages deletes the one-time plan and offers "Keep", which cancels it.
 *
 * @remarks
 * Shown only between a successful run and the deletion. Keep sends the
 * revision the person sees; the page then revalidates and the notice goes.
 */
export function PlanOneShotNotice({
  plan,
  status,
  isHidden = false,
}: {
  readonly plan: AgentPlanView;
  /** The polled status of the plan's run, which tells when a deadline may have been set. */
  readonly status: AgentPlanControl["status"] | undefined;
  /** Shows nothing but keeps following the deadline, as in the collapsed plan panel (PAGE-338). */
  readonly isHidden?: boolean;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  usePlanDeadlineRefresh(plan, status);
  const fetcher = useFetcher<AgentPlanActionResult>();
  const [requestKey, setRequestKey] = useState(() => createRandomUuid());
  const answer = fetcher.state === "idle" ? fetcher.data : undefined;
  const error = answer?.ok === false ? answer.error : null;
  useEffect(() => {
    // A refused request is retried with a fresh key, not with the stored refusal.
    if (error) setRequestKey(createRandomUuid());
  }, [error]);
  if (isHidden || !plan.scheduledDeletionAt) return null;
  const time = deletionTime(plan.scheduledDeletionAt, i18n.language);
  if (time === null) return null;
  function keep(): void {
    void fetcher.submit(
      {
        intent: "keep-plan",
        planId: plan.id,
        revision: String(plan.revision),
        requestKey,
      },
      { method: "post", action: "/agents/plans" },
    );
  }
  return (
    <div
      role="status"
      className="mx-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warning-subtle px-3 py-2 text-xs text-warning"
    >
      <span className="font-semibold">
        {t("plans.manage.oneShotDeletion", { time })}
      </span>
      {plan.canEdit ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 text-xs"
          isPending={fetcher.state !== "idle"}
          onClick={keep}
        >
          {t("plans.manage.oneShotKeep")}
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="text-destructive">
          {t(`settings.agents.error.${error}`, { defaultValue: error })}
        </span>
      ) : null}
    </div>
  );
}
