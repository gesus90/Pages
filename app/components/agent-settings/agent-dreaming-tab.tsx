import { Moon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { dreamSettingsKey } from "./agent-dream-fields";
import { AgentDreamingFiles } from "./agent-dreaming-files";
import { AgentDreamingLog } from "./agent-dreaming-log";
import { AgentDreamingSchedule } from "./agent-dreaming-schedule";
import { AgentTabFooter, AgentTabPlaceholder } from "./agent-dreaming-shell";
import { AgentDreamingStatus } from "./agent-dreaming-status";
import { useAgentDreaming } from "./use-agent-dreaming";
import { useDreamScheduleDraft } from "./use-dream-schedule-draft";

import type { AgentDreamingState } from "./use-agent-dreaming";
import type { AgentDreamingOverview } from "@/definition/AgentDreaming";

interface DreamingContentProps {
  readonly overview: AgentDreamingOverview;
  readonly dreaming: AgentDreamingState;
  readonly onClose: () => void;
  readonly onOpenLessons: () => void;
}

/** "Jetzt träumen"; while a run goes on or waits it is off and says so. */
function RunNowButton({
  overview,
  dreaming,
}: {
  readonly overview: AgentDreamingOverview;
  readonly dreaming: AgentDreamingState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { isRunning, isWaiting } = overview;
  const isBusy = isRunning || dreaming.pendingKey === "run";
  let label = t("agentDreaming.run.now");
  if (isRunning) label = t("agentDreaming.run.running");
  else if (isWaiting) label = t("agentDreaming.run.waitingLabel");
  return (
    <Button
      disabled={
        !overview.canChange || isWaiting || dreaming.pendingKey !== null
      }
      isPending={isBusy}
      onClick={dreaming.runNow}
      variant="outline"
    >
      {isBusy ? null : <Moon aria-hidden="true" className="size-4" />}
      {label}
    </Button>
  );
}

/** Why the last change was refused, or what it did. */
function DreamingNotice({
  dreaming,
}: {
  readonly dreaming: AgentDreamingState;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { failure, outcome } = dreaming;
  if (failure !== null)
    return (
      <p className="text-sm text-destructive" role="alert">
        {t(`agentDreaming.failure.${failure}`)}
      </p>
    );
  if (outcome === null) return null;
  return (
    <p
      className={
        outcome === "saved"
          ? "text-sm text-success"
          : "text-sm text-muted-foreground"
      }
      role="status"
    >
      {t(`agentDreaming.outcome.${outcome}`)}
    </p>
  );
}

/** Cards and footer of an agent whose Dreaming was read. */
function DreamingContent({
  overview,
  dreaming,
  onClose,
  onOpenLessons,
}: DreamingContentProps): React.ReactElement {
  const { t } = useTranslation();
  const draft = useDreamScheduleDraft({
    schedule: overview.schedule,
    model: overview.model,
  });
  const canSave =
    overview.canChange && draft.isChanged && dreaming.pendingKey === null;
  const hasNotice = dreaming.failure !== null || dreaming.outcome !== null;

  function handleSave(): void {
    if (draft.settings !== null) dreaming.saveSettings(draft.settings);
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        <AgentDreamingSchedule overview={overview} draft={draft} />
        <AgentDreamingStatus overview={overview} />
        {overview.canChange ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <AgentDreamingLog run={overview.lastRun} />
            <AgentDreamingFiles
              overview={overview}
              onOpenLessons={onOpenLessons}
            />
          </div>
        ) : null}
      </div>
      <AgentTabFooter
        closeLabel={t("agentDreaming.cancel")}
        notice={hasNotice ? <DreamingNotice dreaming={dreaming} /> : undefined}
        onClose={onClose}
        start={<RunNowButton overview={overview} dreaming={dreaming} />}
      >
        <Button
          disabled={!canSave}
          isPending={dreaming.pendingKey === "settings"}
          onClick={handleSave}
        >
          {t("agentDreaming.save")}
        </Button>
      </AgentTabFooter>
    </>
  );
}

interface AgentDreamingTabProps {
  /** The agent whose Dreaming the tab shows. */
  readonly agentId: string;
  /** Closes the popup. */
  readonly onClose: () => void;
  /** Switches the popup to the tab "Lektionen & Rezepte". */
  readonly onOpenLessons: () => void;
  /** How often the tab reads again while a run goes on or waits; 4 seconds by default. */
  readonly pollIntervalMs?: number;
}

/**
 * The tab "Dreaming" of the agent settings (PAGE-378): the schedule of the
 * dream run and its model, when it ran last and when it runs next, what the
 * last run did, and the files of the memory.
 *
 * @remarks
 * Dreaming is read when the tab opens. After every change the tab shows the
 * overview the server answers with. The entries restart from the saved
 * settings whenever those change, so a save never leaves stale text in them;
 * while a run goes on, new overviews do not touch what is being edited.
 */
export function AgentDreamingTab({
  agentId,
  onClose,
  onOpenLessons,
  pollIntervalMs,
}: AgentDreamingTabProps): React.ReactElement {
  const { t } = useTranslation();
  const dreaming = useAgentDreaming(agentId, pollIntervalMs);
  const { overview, loadFailure } = dreaming;
  if (overview === null)
    return (
      <AgentTabPlaceholder
        loadingText={t("agentDreaming.loading")}
        failureText={
          loadFailure === null
            ? null
            : t(`agentDreaming.failure.${loadFailure}`)
        }
        retryLabel={t("agentDreaming.retry")}
        closeLabel={t("agentDreaming.cancel")}
        onRetry={dreaming.reload}
        onClose={onClose}
      />
    );
  return (
    <DreamingContent
      key={dreamSettingsKey({
        schedule: overview.schedule,
        model: overview.model,
      })}
      overview={overview}
      dreaming={dreaming}
      onClose={onClose}
      onOpenLessons={onOpenLessons}
    />
  );
}
