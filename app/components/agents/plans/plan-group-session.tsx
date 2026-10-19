import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** What a run recorded about a group's shared session; nothing of it is guessed. */
export interface PlanGroupSessionView {
  readonly state: "not_created" | "active" | "closed" | "failed";
  readonly acpSessionId: string | null;
  readonly creator: AgentPlanStepResult | null;
  readonly adapter: AcpProviderId | null;
  readonly turns: number;
}

/** Retirement takes precedence over an older creator record that still looked active. */
function sessionState(
  record: AgentPlanSessionRecord | null,
  acpSessionId: string | null,
  run: AgentPlanRun | null,
): PlanGroupSessionView["state"] {
  if (!record) return "not_created";
  if (acpSessionId === null)
    return record.resultCode === -1 ? "failed" : "not_created";
  if (record.closeout === "pending") {
    if (run && ["succeeded", "failed", "cancelled"].includes(run.status))
      return "failed";
    return "active";
  }
  return record.resultCode === -1 ? "failed" : "closed";
}

/**
 * Reads a group's shared session from the records of its members in one run.
 *
 * @param run - The selected run; without one the session was never created.
 * @param groupId - The group.
 */
export function planRunGroupSession(
  run: AgentPlanRun | null,
  groupId: string,
): PlanGroupSessionView {
  const members = (run?.steps ?? []).filter(
    (step) => step.groupId === groupId && step.session?.group,
  );
  const creator =
    members.find((step) => step.session?.group?.role === "created") ?? null;
  const acpSessionId =
    members
      .map((step) => step.session?.group?.acpSessionId ?? null)
      .find((id) => id !== null) ?? null;
  const retired = members.find((step) =>
    step.session?.events.some((event) =>
      event.startsWith("resource session retired:"),
    ),
  );
  const record = retired?.session ?? creator?.session ?? null;
  return {
    state: sessionState(record, acpSessionId, run),
    acpSessionId,
    creator,
    adapter: record?.group?.adapter ?? null,
    turns: members.length,
  };
}

/**
 * Read-only session information from the selected run, never a plan parameter.
 *
 * @remarks
 * Before the first member opened the session it says so instead of showing a
 * placeholder ID.
 */
export function PlanGroupSessionValue({
  session,
  className,
}: {
  readonly session: PlanGroupSessionView;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const value = session.acpSessionId ?? t("plans.groups.session.notCreated");
  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      title={t("plans.groups.session.hint")}
    >
      <Lock className="size-3 shrink-0" aria-hidden="true" />
      <span className="font-mono">{t("plans.groups.session.label")}</span>
      <span aria-hidden="true">·</span>
      <span className="pages-selectable min-w-0 truncate font-mono text-foreground">
        {value}
      </span>
      {session.acpSessionId ? (
        <span className="shrink-0">
          ({t(`plans.groups.session.state.${session.state}`)})
        </span>
      ) : null}
      <span className="sr-only">{t("plans.groups.session.hint")}</span>
    </p>
  );
}
