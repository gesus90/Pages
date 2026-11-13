import {
  AtSign,
  BookOpen,
  ListCollapse,
  MessageSquare,
  Moon,
  RotateCw,
  Settings,
  Square,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  SESSION_STATE_DOT,
  clampContextPercent,
} from "@/app/components/agent-settings/agent-session-display";
import { canRunSessionAction } from "@/app/components/agent-settings/agent-session-widgets";
import { isAgentSettingsTabAvailable } from "@/app/components/agent-settings/agent-settings-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

import { ChatPageMenuEntry, MENU_SECTION_LABEL } from "./chat-page-menu-entry";
import { useAgentSessionActions } from "./use-agent-session-actions";

import type { LucideIcon } from "lucide-react";
import type { AgentSettingsTab } from "@/app/components/agent-settings/agent-settings-tabs";
import type {
  AgentChatSessionAction,
  AgentChatSessionBrief,
} from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { AgentSessionActions } from "./use-agent-session-actions";

/** What the menu of an agent can lead to besides the session buttons. */
export interface AgentMenuOptions {
  /** Opens the popup "Agent-Einstellungen" of the agent in a tab. */
  readonly onOpenSettings: (
    agent: VirtualParticipant,
    tab: AgentSettingsTab,
  ) => void;
  /** Opens the direct chat with the agent; left out where it makes no sense or is not possible. */
  readonly onOpenDirect?: (agent: VirtualParticipant) => void;
  /** Puts `@username` into the input field; left out in the direct chat with the agent. */
  readonly onMention?: (agent: VirtualParticipant) => void;
}

/** Whether the menu of an agent is open; a right click opens it, too. */
export interface AgentMenuState {
  readonly isOpen: boolean;
  setIsOpen(isOpen: boolean): void;
  /** Replaces the browser's context menu with the one of the agent. */
  openFromContextMenu(event: React.MouseEvent): void;
}

/** The open state of the menu of one agent and the handler of its right click. */
export function useAgentMenuState(): AgentMenuState {
  const [isOpen, setIsOpen] = useState(false);

  function openFromContextMenu(event: React.MouseEvent): void {
    event.preventDefault();
    setIsOpen(true);
  }

  return { isOpen, setIsOpen, openFromContextMenu };
}

const SESSION_ENTRIES: readonly {
  readonly action: AgentChatSessionAction;
  readonly icon: LucideIcon;
}[] = [
  { action: "stop", icon: Square },
  { action: "summarize", icon: ListCollapse },
  { action: "restart", icon: RotateCw },
];

/** "Status: arbeitet · 58 % Kontext", or that the chat has no session yet. */
function SessionStatusLine({
  brief,
}: {
  readonly brief: AgentChatSessionBrief | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  if (brief === undefined)
    return (
      <DropdownMenuLabel className="py-1.5 text-[13px] font-normal text-muted-foreground">
        {t("chatPage.agentMenu.noSession")}
      </DropdownMenuLabel>
    );
  const state = t(`agentSessions.state.${brief.state}`);
  const percent = clampContextPercent(brief.contextPercent);
  return (
    <DropdownMenuLabel className="flex items-center gap-2 py-1.5 text-[13px] font-normal text-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          SESSION_STATE_DOT[brief.state],
        )}
      />
      {percent === null
        ? t("chatPage.agentMenu.statusPlain", { state })
        : t("chatPage.agentMenu.status", { state, percent })}
    </DropdownMenuLabel>
  );
}

/** The state of the session in this chat and the buttons that stop, summarize and restart it. */
function SessionSection({
  agent,
  brief,
  actions,
}: {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
  readonly actions: AgentSessionActions;
}): React.ReactElement {
  const { t } = useTranslation();

  function handleSelect(action: AgentChatSessionAction): void {
    if (brief !== undefined) actions.run(action, brief);
  }

  return (
    <>
      <DropdownMenuLabel className={MENU_SECTION_LABEL}>
        {t("chatPage.agentMenu.section", { name: agent.name })}
      </DropdownMenuLabel>
      <SessionStatusLine brief={brief} />
      {SESSION_ENTRIES.map(({ action, icon }) => (
        <ChatPageMenuEntry
          key={action}
          icon={icon}
          label={t(`chatPage.agentMenu.${action}`)}
          isDisabled={
            brief === undefined ||
            actions.pendingKey !== null ||
            !canRunSessionAction(action, brief)
          }
          onSelect={() => handleSelect(action)}
        />
      ))}
    </>
  );
}

interface TabEntryProps {
  readonly tab: AgentSettingsTab;
  readonly icon: LucideIcon;
  readonly label: string;
  /** The remark while the tab works; one that does not work yet says "folgt". */
  readonly note?: string;
  readonly onOpen: () => void;
}

/** An entry that opens the popup in a tab; off while the function of the tab is missing. */
function TabEntry({
  tab,
  icon,
  label,
  note,
  onOpen,
}: TabEntryProps): React.ReactElement {
  const { t } = useTranslation();
  const isAvailable = isAgentSettingsTabAvailable(tab);
  return (
    <ChatPageMenuEntry
      icon={icon}
      label={label}
      note={isAvailable ? note : t("chatPage.agentMenu.soon")}
      isDisabled={!isAvailable}
      onSelect={onOpen}
    />
  );
}

/** The section "Agent": the popup in its tabs, the direct chat and the mention. */
function AgentSection({
  agent,
  options,
}: {
  readonly agent: VirtualParticipant;
  readonly options: AgentMenuOptions;
}): React.ReactElement {
  const { t } = useTranslation();
  const { onOpenDirect, onMention } = options;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={MENU_SECTION_LABEL}>
        {t("chatPage.agentMenu.agentSection")}
      </DropdownMenuLabel>
      <TabEntry
        tab="sessions"
        icon={Settings}
        label={t("chatPage.agentMenu.settings")}
        note={t("chatPage.agentMenu.settingsNote")}
        onOpen={() => options.onOpenSettings(agent, "sessions")}
      />
      <TabEntry
        tab="logbook"
        icon={BookOpen}
        label={t("chatPage.agentMenu.logbook")}
        onOpen={() => options.onOpenSettings(agent, "logbook")}
      />
      <TabEntry
        tab="dreaming"
        icon={Moon}
        label={t("chatPage.agentMenu.dreaming")}
        onOpen={() => options.onOpenSettings(agent, "dreaming")}
      />
      {onOpenDirect === undefined && onMention === undefined ? null : (
        <DropdownMenuSeparator />
      )}
      {onOpenDirect === undefined ? null : (
        <ChatPageMenuEntry
          icon={MessageSquare}
          label={t("chatPage.agentMenu.openDirect", { name: agent.name })}
          onSelect={() => onOpenDirect(agent)}
        />
      )}
      {onMention === undefined ? null : (
        <ChatPageMenuEntry
          icon={AtSign}
          label={t("chatPage.agentMenu.mention", { name: agent.name })}
          onSelect={() => onMention(agent)}
        />
      )}
    </>
  );
}

interface ChatPageAgentMenuProps {
  readonly agent: VirtualParticipant;
  /** The session of the agent in the opened chat; `undefined` before its first message. */
  readonly brief: AgentChatSessionBrief | undefined;
  readonly options: AgentMenuOptions;
  readonly state: AgentMenuState;
  /** The element that opens the menu with a click. */
  readonly children: React.ReactElement;
}

/**
 * The menu of an agent in the chat (PAGE-376): its session in this chat with
 * the buttons "Sitzung anhalten", "Sitzung zusammenfassen" and "Sitzung neu
 * starten", then the agent's settings, its direct chat and its mention.
 *
 * @remarks
 * A click on `children` opens it, and so does a right click wherever the
 * caller wires `state.openFromContextMenu`. "Lagebuch …" opens the popup in
 * its tab (PAGE-377); Dreaming stays off until its tab works.
 */
export function ChatPageAgentMenu({
  agent,
  brief,
  options,
  state,
  children,
}: ChatPageAgentMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const actions = useAgentSessionActions();
  return (
    <>
      <DropdownMenu open={state.isOpen} onOpenChange={state.setIsOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <SessionSection agent={agent} brief={brief} actions={actions} />
          <AgentSection agent={agent} options={options} />
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.failure === null ? null : (
        <span className="text-xs text-destructive" role="alert">
          {t("chatPage.agentMenu.failed")}
        </span>
      )}
    </>
  );
}
