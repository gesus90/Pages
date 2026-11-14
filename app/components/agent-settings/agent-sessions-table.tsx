import { useTranslation } from "react-i18next";

import { AgentCheckTime } from "@/app/components/settings/agents/agent-check-time";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { cn } from "@/app/lib/cn";

import {
  formatTokenCount,
  isContextCritical,
  isCurrentSession,
  sessionChatName,
} from "./agent-session-display";
import {
  ContextMeter,
  SessionActionButtons,
  SessionStateLabel,
} from "./agent-session-widgets";

import type { AgentSettingsCurrentChat } from "./agent-settings-types";
import type {
  AgentChatSessionAction,
  AgentChatSessionView,
} from "@/definition/AgentChatSession";

const COLUMNS = [
  "chat",
  "kind",
  "state",
  "context",
  "waiting",
  "tokens",
  "lastActivity",
  "actions",
] as const;

interface SessionRowProps {
  readonly view: AgentChatSessionView;
  readonly isCurrent: boolean;
  /** The saved restart threshold, from which a context shows red. */
  readonly restartPercent: number;
  readonly pendingKey: string | null;
  readonly onAction: (
    action: AgentChatSessionAction,
    sessionId: string,
  ) => void;
}

/** The chat of a row: its name, and the mark when the popup was opened from it. */
function ChatCell({
  view,
  isCurrent,
}: {
  readonly view: AgentChatSessionView;
  readonly isCurrent: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm font-medium text-foreground">
        {sessionChatName(view.chat, t)}
      </span>
      {isCurrent ? (
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
          {t("agentSessions.thisChat")}
        </span>
      ) : null}
    </div>
  );
}

/** One session: chat, type, state, context, waiting, tokens, last activity and buttons. */
function SessionRow({
  view,
  isCurrent,
  restartPercent,
  pendingKey,
  onAction,
}: SessionRowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const chatName = sessionChatName(view.chat, t);
  const kind = view.chat.isConfidential ? "confidential" : view.chat.kind;
  return (
    <tr
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "border-t border-border/60 align-middle",
        isCurrent && "bg-primary-subtle",
      )}
    >
      <td className="px-3 py-3">
        <ChatCell view={view} isCurrent={isCurrent} />
      </td>
      <td className="px-3 py-3">
        <span className="rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
          {t(`agentSessions.kind.${kind}`)}
        </span>
      </td>
      <td className="px-3 py-3">
        <SessionStateLabel state={view.state} />
      </td>
      <td className="px-3 py-3">
        <ContextMeter
          percent={view.contextPercent}
          isCritical={isContextCritical(view, restartPercent)}
          label={t("agentSessions.contextMeter", { chat: chatName })}
        />
      </td>
      <td className="px-3 py-3 tabular-nums">
        {view.waitingMessages > 0 ? view.waitingMessages : "–"}
      </td>
      <td className="px-3 py-3 whitespace-nowrap tabular-nums">
        {formatTokenCount(view.tokens, t, i18n.language)}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">
        {view.lastActivityAt === null ? (
          "—"
        ) : (
          <AgentCheckTime checkedAt={view.lastActivityAt} />
        )}
      </td>
      <td className="px-3 py-3">
        <SessionActionButtons
          brief={view}
          subject={chatName}
          pendingKey={pendingKey}
          onAction={onAction}
        />
      </td>
    </tr>
  );
}

interface AgentSessionsTableProps {
  readonly agentName: string;
  readonly sessions: readonly AgentChatSessionView[];
  readonly restartPercent: number;
  readonly currentChat: AgentSettingsCurrentChat | undefined;
  readonly pendingKey: string | null;
  readonly onAction: (
    action: AgentChatSessionAction,
    sessionId: string,
  ) => void;
}

/**
 * The table of all chat sessions of an agent, the one of the opened chat
 * highlighted. It scrolls sideways on narrow screens.
 */
export function AgentSessionsTable({
  agentName,
  sessions,
  restartPercent,
  currentChat,
  pendingKey,
  onAction,
}: AgentSessionsTableProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea className="rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          {t("agentSessions.tableLabel", { name: agentName })}
        </caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="px-3 py-3 font-medium" scope="col">
                {t(`agentSessions.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((view) => (
            <SessionRow
              key={view.sessionId}
              view={view}
              isCurrent={isCurrentSession(view, currentChat)}
              restartPercent={restartPercent}
              pendingKey={pendingKey}
              onAction={onAction}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
