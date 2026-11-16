import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanSwarmKindBadge, PlanSwarmMemoryText } from "./plan-swarm-memory";
import { planSwarmActivities, planSwarmTime } from "./plan-swarm-memory-model";

import type { AgentPlanSwarmMemoryView } from "@/definition/AgentPlanSwarmMemory";
import type { PlanSwarmActivity } from "./plan-swarm-memory-model";

/** The open contradictions the main model named, in the warning box of the run view. */
function Contradictions(props: {
  readonly memory: AgentPlanSwarmMemoryView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { contradictions } = props.memory.snapshot;
  if (contradictions.length === 0) return null;
  return (
    <div
      role="note"
      className="mx-3 mt-2 rounded-md border border-warning/40 bg-warning-subtle px-2 py-1.5 text-xs text-warning"
      data-plan-swarm-contradictions
    >
      <p className="flex items-center gap-1 font-semibold">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        {t("plans.swarm.memory.contradictions", {
          count: contradictions.length,
        })}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 wrap-anywhere text-foreground">
        {contradictions.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

/** The head of one activity: time, agent, kind and revision or refusal. */
function ActivityHead(props: {
  readonly activity: PlanSwarmActivity;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { activity } = props;
  const author =
    activity.kind === "entry"
      ? activity.entry.author
      : activity.rejection.author;
  const kind =
    activity.kind === "entry" ? activity.entry.kind : activity.rejection.kind;
  const isSuperseded =
    activity.kind === "entry" && activity.entry.supersededBy !== null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground tabular-nums">
        {planSwarmTime(activity.at, i18n.language)}
      </span>
      <span className="font-semibold">{author}</span>
      <PlanSwarmKindBadge kind={kind} />
      {isSuperseded ? (
        <span className="text-muted-foreground">
          {t("plans.swarm.memory.superseded")}
        </span>
      ) : null}
      <span className="ml-auto text-muted-foreground tabular-nums">
        {activity.kind === "entry"
          ? `r${String(activity.entry.revision)}`
          : t("plans.swarm.memory.refused")}
      </span>
    </div>
  );
}

/** One activity: a stored entry, struck through once superseded, or a refused one with its reason. */
function ActivityRow(props: {
  readonly activity: PlanSwarmActivity;
}): React.ReactElement {
  const { t } = useTranslation();
  const { activity } = props;
  if (activity.kind === "rejection")
    return (
      <li className="flex flex-col gap-0.5" data-plan-swarm-rejection>
        <ActivityHead activity={activity} />
        <p className="text-destructive">
          {t("plans.swarm.memory.refusedReason", {
            reason: t(
              `plans.swarm.memory.reasons.${activity.rejection.reason}`,
              {
                defaultValue: activity.rejection.reason,
              },
            ),
          })}
        </p>
        <PlanSwarmMemoryText
          text={activity.rejection.text}
          className="text-muted-foreground"
        />
      </li>
    );
  const isSuperseded = activity.entry.supersededBy !== null;
  return (
    <li
      className="flex flex-col gap-0.5"
      data-plan-swarm-activity={activity.entry.revision}
      data-superseded={isSuperseded ? "true" : undefined}
    >
      <ActivityHead activity={activity} />
      <PlanSwarmMemoryText
        text={activity.entry.text}
        className={cn(isSuperseded && "text-muted-foreground line-through")}
      />
    </li>
  );
}

/**
 * The tab Aktivitäten: every event with time, agent, kind and revision,
 * newest first, the open contradictions on top.
 */
export function PlanSwarmActivityTab(props: {
  readonly memory: AgentPlanSwarmMemoryView;
}): React.ReactElement {
  const { t } = useTranslation();
  const activities = planSwarmActivities(props.memory);
  return (
    <div className="flex flex-col text-xs" data-plan-swarm-activities>
      <Contradictions memory={props.memory} />
      {activities.length === 0 ? (
        <p className="px-3 py-2 text-muted-foreground">
          {t("plans.swarm.memory.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 px-3 py-2">
          {activities.map((activity) => (
            <ActivityRow key={activity.key} activity={activity} />
          ))}
        </ul>
      )}
      <p className="border-t border-border px-3 py-1.5 text-muted-foreground">
        {t("plans.swarm.memory.dataNote")}
      </p>
    </div>
  );
}
