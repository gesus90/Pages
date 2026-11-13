import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { AgentLogbookEntries } from "./agent-logbook-entries";
import { AgentLogbookSummary } from "./agent-logbook-summary";
import { useAgentLogbook } from "./use-agent-logbook";
import { useLogbookSettingsDraft } from "./use-logbook-settings-draft";

import type { AgentLogbookState } from "./use-agent-logbook";
import type { AgentLogbookOverview } from "@/definition/AgentLogbook";

interface SaveControl {
  readonly isDisabled: boolean;
  readonly isPending: boolean;
  readonly onSave: () => void;
}

/** "Abbrechen" and, when the settings can be saved, "Speichern". */
function LogbookFooter({
  onClose,
  save,
}: {
  readonly onClose: () => void;
  readonly save: SaveControl | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <footer className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-surface px-6 py-4">
      <Button onClick={onClose} variant="outline">
        {t("agentLogbook.cancel")}
      </Button>
      {save === null ? null : (
        <Button
          disabled={save.isDisabled}
          isPending={save.isPending}
          onClick={save.onSave}
        >
          {t("agentLogbook.save")}
        </Button>
      )}
    </footer>
  );
}

interface LogbookContentProps {
  readonly overview: AgentLogbookOverview;
  readonly logbook: AgentLogbookState;
  readonly onClose: () => void;
}

/** Cards, list and footer of an agent whose Lagebuch was read. */
function LogbookContent({
  overview,
  logbook,
  onClose,
}: LogbookContentProps): React.ReactElement {
  const { t } = useTranslation();
  const draft = useLogbookSettingsDraft(overview.settings);

  function handleSave(): void {
    if (draft.settings !== null) logbook.saveSettings(draft.settings);
  }

  return (
    <>
      <div className="flex flex-col gap-5 px-6 py-5">
        <AgentLogbookSummary overview={overview} draft={draft} />
        <AgentLogbookEntries
          agentName={overview.agentName}
          entries={overview.entries}
          chats={overview.chats}
          isBusy={logbook.pendingKey !== null}
          onRemove={(entryId) => logbook.removeEntries([entryId])}
        />
        {logbook.failure === null ? null : (
          <p className="text-sm text-destructive" role="alert">
            {t(`agentLogbook.failure.${logbook.failure}`)}
          </p>
        )}
        {logbook.hasSavedSettings ? (
          <p className="text-sm text-success" role="status">
            {t("agentLogbook.settings.saved")}
          </p>
        ) : null}
      </div>
      <LogbookFooter
        onClose={onClose}
        save={{
          isDisabled:
            !overview.canChangeSettings ||
            draft.settings === null ||
            logbook.pendingKey !== null,
          isPending: logbook.pendingKey === "settings",
          onSave: handleSave,
        }}
      />
    </>
  );
}

/** The loading hint, or why the Lagebuch could not be read and the way to try again. */
function LogbookPlaceholder({
  logbook,
  onClose,
}: {
  readonly logbook: AgentLogbookState;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const failure = logbook.loadFailure;
  return (
    <>
      <div className="flex flex-col items-start gap-3 px-6 py-8">
        {failure === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("agentLogbook.loading")}
          </p>
        ) : (
          <>
            <p className="text-sm text-destructive" role="alert">
              {t(`agentLogbook.failure.${failure}`)}
            </p>
            <Button onClick={logbook.reload} size="sm" variant="outline">
              {t("agentLogbook.retry")}
            </Button>
          </>
        )}
      </div>
      <LogbookFooter onClose={onClose} save={null} />
    </>
  );
}

/**
 * The tab "Lagebuch" of the agent settings (PAGE-377): fill level, limit,
 * quiet time and model of the background summary, and the entries with search
 * and filters by kind and chat, each removable.
 *
 * @remarks
 * The Lagebuch is read when the tab opens. After every change the tab shows
 * the overview the server answers with, and the entries restart from the saved
 * settings whenever those change, so a save never leaves stale text in them.
 *
 * @param props - The agent whose Lagebuch the tab shows, and the callback that
 * closes the popup.
 * @returns The tab content or its loading and failure placeholder.
 */
export function AgentLogbookTab({
  agentId,
  onClose,
}: {
  readonly agentId: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const logbook = useAgentLogbook(agentId);
  const { overview } = logbook;
  if (overview === null)
    return <LogbookPlaceholder logbook={logbook} onClose={onClose} />;
  const { limit, quietMinutes, model } = overview.settings;
  return (
    <LogbookContent
      key={`${String(limit)}:${String(quietMinutes)}:${model?.connectionId ?? ""}:${model?.model ?? ""}`}
      overview={overview}
      logbook={logbook}
      onClose={onClose}
    />
  );
}
