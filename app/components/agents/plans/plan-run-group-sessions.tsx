import { useTranslation } from "react-i18next";

import {
  PlanGroupSessionValue,
  planRunGroupSession,
} from "./plan-group-session";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

function Facts({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[];
}): React.ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="pages-selectable break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * How one member took part in its group's shared session in this run.
 *
 * @remarks
 * The ACP session ID, the adapter's own session ID and the Pages node that
 * opened the session are named apart; a missing value stays visible as such.
 */
export function PlanRunStepGroupSession({
  run,
  step,
}: {
  readonly run: AgentPlanRun;
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const link = step.session?.group;
  if (!link) return null;
  const creator = run.steps.find((entry) => entry.id === link.creatorStepId);
  return (
    <section
      aria-label={t("plans.groups.session.title")}
      className="space-y-2 rounded-lg border border-plan-group/40 bg-plan-group-subtle/60 p-3 text-sm"
    >
      <p className="font-medium">
        {t(`plans.groups.session.role.${link.role}`, { turn: link.turn })}
      </p>
      <Facts
        rows={[
          [
            t("plans.groups.session.acpId"),
            link.acpSessionId ?? t("plans.groups.session.notCreated"),
          ],
          [
            t("plans.groups.session.nativeId"),
            link.nativeSessionId ?? t("plans.groups.session.nativeMissing"),
          ],
          [
            t("plans.groups.session.adapter"),
            t(`plans.groups.adapter.${link.adapter}`),
          ],
          [
            t("plans.groups.session.creator"),
            creator?.name ?? link.creatorStepId,
          ],
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {t("plans.groups.session.runScope")}
      </p>
    </section>
  );
}

/** Every group of the run with its shared session, as its members recorded it. */
export function PlanRunGroupSessions({
  run,
}: {
  readonly run: AgentPlanRun;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const groupIds = new Set(run.steps.map((step) => step.groupId));
  const groups = run.steps.filter((step) => groupIds.has(step.id));
  if (groups.length === 0) return null;
  return (
    <section
      aria-label={t("plans.groups.session.title")}
      className="space-y-2 rounded-lg border border-border p-3 text-sm"
    >
      <h3 className="font-medium">{t("plans.groups.session.title")}</h3>
      <ul className="space-y-2">
        {groups.map((group) => {
          const session = planRunGroupSession(run, group.id);
          return (
            <li key={group.id} className="space-y-1">
              <p className="font-medium">{group.name}</p>
              <PlanGroupSessionValue session={session} />
              <p className="text-xs text-muted-foreground">
                {t("plans.groups.session.creator")}:{" "}
                {session.creator?.name ?? "—"} ·{" "}
                {t("plans.groups.session.turns")}: {session.turns}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
