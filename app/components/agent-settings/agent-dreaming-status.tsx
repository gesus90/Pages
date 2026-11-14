import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import {
  describeDreamCounts,
  describeDreamError,
} from "./agent-dreaming-display";
import { DreamBadge, DreamCard } from "./agent-dreaming-widgets";

import type { DreamBadgeTone } from "./agent-dreaming-widgets";
import type {
  AgentDreamRunStatus,
  AgentDreamRunView,
  AgentDreamingOverview,
} from "@/definition/AgentDreaming";

const RUN_TONES: Readonly<Record<AgentDreamRunStatus, DreamBadgeTone>> = {
  updated: "success",
  unchanged: "neutral",
  failed: "destructive",
};

/** Time, result, trigger and counts of a finished run. */
function LastRunBody({
  run,
}: {
  readonly run: AgentDreamRunView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold text-foreground tabular-nums">
          {formatDateTime(run.at)}
        </p>
        <DreamBadge tone={RUN_TONES[run.status]}>
          {t(`agentDreaming.status.${run.status}`)}
        </DreamBadge>
      </div>
      {run.trigger === null ? null : (
        <p className="text-xs text-muted-foreground">
          {t("agentDreaming.lastRun.trigger", {
            trigger: t(`agentDreaming.trigger.${run.trigger}`),
          })}
        </p>
      )}
      {run.status === "failed" && run.errorCode !== null ? (
        <p className="text-sm text-destructive">
          {describeDreamError(run.errorCode, t)}
        </p>
      ) : null}
      <p className="text-sm text-foreground">
        {describeDreamCounts(run.counts, t)}
      </p>
    </div>
  );
}

/** The card "Letzter Lauf", or that no run happened yet. */
function LastRunCard({
  run,
}: {
  readonly run: AgentDreamRunView | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DreamCard title={t("agentDreaming.cards.lastRun")}>
      {run === null ? (
        <p className="text-sm text-muted-foreground">
          {t("agentDreaming.lastRun.none")}
        </p>
      ) : (
        <LastRunBody run={run} />
      )}
    </DreamCard>
  );
}

/** The card "Nächster Lauf": when it is due, that it runs now or waits, or that it is off. */
function NextRunCard({
  overview,
}: {
  readonly overview: AgentDreamingOverview;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const { isRunning, isWaiting, nextRunAt } = overview;
  const isOff = !isRunning && !isWaiting && nextRunAt === null;
  let text = formatDateTime(nextRunAt);
  if (isRunning) text = t("agentDreaming.nextRun.running");
  else if (isWaiting) text = t("agentDreaming.nextRun.waiting");
  else if (isOff) text = t("agentDreaming.nextRun.off");
  return (
    <DreamCard title={t("agentDreaming.cards.nextRun")}>
      <p className="text-lg font-semibold text-foreground tabular-nums">
        {text}
      </p>
      {isOff ? (
        <p className="text-xs text-muted-foreground">
          {t("agentDreaming.nextRun.offHint")}
        </p>
      ) : null}
    </DreamCard>
  );
}

/** The two cards "Letzter Lauf" and "Nächster Lauf" side by side. */
export function AgentDreamingStatus({
  overview,
}: {
  readonly overview: AgentDreamingOverview;
}): React.ReactElement {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <LastRunCard run={overview.lastRun} />
      <NextRunCard overview={overview} />
    </div>
  );
}
