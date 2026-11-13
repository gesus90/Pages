import { useTranslation } from "react-i18next";

import { isContextCritical } from "@/app/components/agent-settings/agent-session-display";
import {
  ContextMeter,
  SessionActionButtons,
  SessionStateLabel,
} from "@/app/components/agent-settings/agent-session-widgets";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ParticipantAvatar } from "./chat-page-avatar";
import { useAgentSessionActions } from "./use-agent-session-actions";

import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { AgentSessionActions } from "./use-agent-session-actions";

/** An agent of the opened chat and its session in it, if it has one yet. */
export interface AgentSessionEntry {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
}

interface EntryRowProps {
  readonly entry: AgentSessionEntry;
  readonly actions: AgentSessionActions;
  readonly onOpenSettings: (agent: VirtualParticipant) => void;
}

/** The session of the agent in this chat: state, context, waiting messages and buttons. */
function SessionDetails({
  entry,
  actions,
}: Omit<EntryRowProps, "onOpenSettings">): React.ReactElement {
  const { t } = useTranslation();
  const { agent, brief } = entry;
  if (brief === undefined)
    return (
      <span className="text-sm text-muted-foreground">
        {t("chatPage.agentSessions.noSession")}
      </span>
    );
  return (
    <>
      <span className="w-28 text-sm">
        <SessionStateLabel state={brief.state} />
      </span>
      <ContextMeter
        percent={brief.contextPercent}
        isCritical={isContextCritical(brief, null)}
        label={t("agentSessions.contextMeter", { chat: agent.name })}
      />
      <span className="w-36 text-xs text-muted-foreground">
        {brief.waitingMessages > 0
          ? t("chatPage.agentStatus.waiting", { count: brief.waitingMessages })
          : ""}
      </span>
      <SessionActionButtons
        brief={brief}
        subject={agent.name}
        pendingKey={actions.pendingKey}
        onAction={(action) => actions.run(action, brief)}
      />
    </>
  );
}

function EntryRow({
  entry,
  actions,
  onOpenSettings,
}: EntryRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { agent } = entry;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <span className="flex min-w-36 flex-1 items-center gap-2">
        <ParticipantAvatar participant={agent} size={26} />
        <span className="text-sm font-medium text-foreground">
          {agent.name}
        </span>
      </span>
      <SessionDetails entry={entry} actions={actions} />
      <Button onClick={() => onOpenSettings(agent)} size="xs" variant="link">
        {t("chatPage.agentMenu.settings")}
      </Button>
    </li>
  );
}

interface ChatPageAgentSessionsDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The name of the opened chat. */
  readonly chatName: string;
  readonly entries: readonly AgentSessionEntry[];
  /** Opens the popup "Agent-Einstellungen" of an agent. */
  readonly onOpenSettings: (agent: VirtualParticipant) => void;
}

/**
 * "Sitzungen der Agenten in diesem Chat" (PAGE-376): for every agent of the
 * chat its session here, with the buttons to stop, summarize and restart it
 * and the way to the agent's settings.
 */
export function ChatPageAgentSessionsDialog({
  isOpen,
  onOpenChange,
  chatName,
  entries,
  onOpenSettings,
}: ChatPageAgentSessionsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actions = useAgentSessionActions();
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(52rem,94vw)]" size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.agentSessions.title", { name: chatName })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("chatPage.agentSessions.description")}
        </DialogDescription>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("chatPage.agentSessions.empty")}
          </p>
        ) : (
          <ul
            aria-label={t("chatPage.agentSessions.list")}
            className="mt-3 divide-y divide-border/60"
          >
            {entries.map((entry) => (
              <EntryRow
                key={entry.agent.id}
                entry={entry}
                actions={actions}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </ul>
        )}
        {actions.failure === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t("chatPage.agentMenu.failed")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
