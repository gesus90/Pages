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

/** The lifetime of the session follows the record of the member that opened it. */
function sessionState(
  record: AgentPlanSessionRecord | null,
  acpSessionId: string | null,
): PlanGroupSessionView["state"] {
  if (!record) return "not_created";
  if (acpSessionId === null)
    return record.resultCode === -1 ? "failed" : "not_created";
  if (record.closeout === "pending") return "active";
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
  const record = creator?.session ?? null;
  return {
    state: sessionState(record, acpSessionId),
    acpSessionId,
    creator,
    adapter: record?.group?.adapter ?? null,
    turns: members.length,
  };
}

/**
 * The read-only runtime parameter `session_id` of a group, as the run reported it.
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
