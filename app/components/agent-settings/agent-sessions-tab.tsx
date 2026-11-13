import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { AgentSessionsSummary } from "./agent-sessions-summary";
import { AgentSessionsTable } from "./agent-sessions-table";
import { useSessionSettingsDraft } from "./use-session-settings-draft";

import type { AgentSettingsCurrentChat } from "./agent-settings-types";
import type { AgentSessionsState } from "./use-agent-sessions";
import type { AgentChatSessionOverview } from "@/definition/AgentChatSession";

interface SaveControl {
  readonly isDisabled: boolean;
  readonly isPending: boolean;
  readonly onSave: () => void;
}

/** "Abbrechen" and, when the settings can be saved, "Speichern". */
function SessionsFooter({
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
        {t("agentSessions.cancel")}
      </Button>
      {save === null ? null : (
        <Button
          disabled={save.isDisabled}
          isPending={save.isPending}
          onClick={save.onSave}
        >
          {t("agentSessions.save")}
        </Button>
      )}
    </footer>
  );
}

interface AgentSessionsContentProps {
  readonly overview: AgentChatSessionOverview;
  readonly sessions: AgentSessionsState;
  readonly currentChat: AgentSettingsCurrentChat | undefined;
  readonly onClose: () => void;
}

/** Cards, table and footer of an agent whose sessions were read. */
function AgentSessionsContent({
  overview,
  sessions,
  currentChat,
  onClose,
}: AgentSessionsContentProps): React.ReactElement {
  const { t } = useTranslation();
  const draft = useSessionSettingsDraft(overview.settings);
  const { failure, pendingKey } = sessions.request;

  function handleSave(): void {
    if (draft.settings !== null) sessions.saveSettings(draft.settings);
  }

  return (
    <>
      <div className="flex flex-col gap-5 px-6 py-5">
        <AgentSessionsSummary overview={overview} draft={draft} />
        {overview.sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t("agentSessions.empty")}
          </p>
        ) : (
          <AgentSessionsTable
            agentName={overview.agentName}
            sessions={overview.sessions}
            restartPercent={overview.settings.restartPercent}
            currentChat={currentChat}
            pendingKey={pendingKey}
            onAction={sessions.runAction}
          />
        )}
        {failure === null ? null : (
          <p className="text-sm text-destructive" role="alert">
            {t(`agentSessions.failure.${failure}`)}
          </p>
        )}
        {sessions.hasSavedSettings ? (
          <p className="text-sm text-success" role="status">
            {t("agentSessions.settings.saved")}
          </p>
        ) : null}
      </div>
      <SessionsFooter
        onClose={onClose}
        save={{
          isDisabled:
            !overview.canChangeSettings ||
            draft.settings === null ||
            pendingKey !== null,
          isPending: pendingKey === "settings",
          onSave: handleSave,
        }}
      />
    </>
  );
}

/** The loading hint, or why the sessions could not be read and the way to try again. */
function SessionsPlaceholder({
  sessions,
  onClose,
}: {
  readonly sessions: AgentSessionsState;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const failure = sessions.loadFailure;
  return (
    <>
      <div className="flex flex-col items-start gap-3 px-6 py-8">
        {failure === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("agentSessions.loading")}
          </p>
        ) : (
          <>
            <p className="text-sm text-destructive" role="alert">
              {t(`agentSessions.failure.${failure}`)}
            </p>
            <Button onClick={sessions.reload} size="sm" variant="outline">
              {t("agentSessions.retry")}
            </Button>
          </>
        )}
      </div>
      <SessionsFooter onClose={onClose} save={null} />
    </>
  );
}

/**
 * The tab "Sitzungen" of the agent settings (PAGE-376): the cards for open
 * sessions, tokens and behavior, the table of all sessions of the agent with
 * the buttons for each, and the footer that saves the two settings.
 *
 * @remarks
 * After every change the table shows the overview the server answers with.
 * The entries restart from the saved settings whenever those change, so a
 * save never leaves stale text in them.
 */
export function AgentSessionsTab({
  sessions,
  currentChat,
  onClose,
}: {
  readonly sessions: AgentSessionsState;
  readonly currentChat: AgentSettingsCurrentChat | undefined;
  readonly onClose: () => void;
}): React.ReactElement {
  const { overview } = sessions;
  if (overview === null)
    return <SessionsPlaceholder sessions={sessions} onClose={onClose} />;
  return (
    <AgentSessionsContent
      key={`${String(overview.settings.idleMinutes)}:${String(overview.settings.restartPercent)}`}
      overview={overview}
      sessions={sessions}
      currentChat={currentChat}
      onClose={onClose}
    />
  );
}
