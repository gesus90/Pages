import { Square, TriangleAlert, UserMinus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { AgentSessionStatus } from "./chat-page-agent-status";
import { useAgentMenuState } from "./chat-page-agent-menu";
import {
  ChatModelBadge,
  ChatPageAgentButton,
  ChatPageAgentChip,
} from "./chat-page-agent-triggers";
import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";
import { ChatPageGroupDialogs } from "./chat-page-group-dialogs";
import {
  AgentConversationBadge,
  participantSubtitle,
} from "./chat-page-list-entries";
import { ChatPageMenuEntry } from "./chat-page-menu-entry";
import { ChatPageModelDialog } from "./chat-page-model-dialog";
import { ChatPageRemoveDialog } from "./chat-page-remove-dialog";
import {
  DirectChatMenu,
  GroupChatMenu,
} from "./chat-menu/chat-page-header-menu";
import { ChatPageScheduledTasks } from "./chat-page-scheduled-tasks";

import type { ReactNode } from "react";
import type { AgentSettingsTab } from "@/app/components/agent-settings/agent-settings-tabs";
import type {
  AgentSettingsCurrentChat,
  AgentSettingsIdentity,
} from "@/app/components/agent-settings/agent-settings-types";
import type {
  VirtualChatSelection,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { AgentChatControlTarget } from "@/definition/AgentChatControl";
import type { AgentMenuOptions } from "./chat-page-agent-menu";
import type { RemovalCandidate } from "./chat-page-remove-dialog";
import type { ChatMenuSwitches } from "./chat-menu/chat-page-header-menu";
import type { GroupDialogKind } from "./chat-page-group-dialogs";
import type { OpenedConversation } from "./use-chat-page";

function HeaderFrame({
  avatar,
  title,
  subtitle,
  aside,
  onContextMenu,
}: {
  readonly avatar: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly aside: ReactNode;
  /** Takes a right click on avatar and title, as the head of an agent opens its menu with it. */
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-4">
      <div
        className="flex min-w-0 flex-1 items-center gap-x-4"
        onContextMenu={onContextMenu}
      >
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-xl font-semibold text-foreground">
            {title}
          </h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{aside}</div>
    </header>
  );
}

/** What the heads of agents and groups lead to; the chat page wires it. */
interface HeaderLinks {
  /** Opens the popup "Agent-Einstellungen" of an agent in a tab. */
  readonly onOpenSettings: (
    agent: VirtualParticipant,
    tab: AgentSettingsTab,
  ) => void;
  /** Opens a conversation of the list, such as the direct chat with an agent. */
  readonly onSelect?: (selection: VirtualChatSelection) => void;
  /** Puts `@username` into the input field. */
  readonly onMention?: (username: string) => void;
  /** Opens "Modell in diesem Chat …" for an agent. */
  readonly onOpenModel: (
    agent: VirtualParticipant,
    target: AgentChatControlTarget,
  ) => void;
  /** Asks to remove a member of the opened group. */
  readonly onRemove: (member: RemovalCandidate) => void;
}

/** The menu of an agent chip in a group: its direct chat and mention make sense only there. */
function groupAgentOptions(
  links: HeaderLinks,
  group: VirtualGroup,
  participants: readonly VirtualParticipant[],
  agent: VirtualParticipant,
): AgentMenuOptions {
  const { onSelect, onMention } = links;
  const hasDirectChat = participants.some((entry) => entry.id === agent.id);
  const target: AgentChatControlTarget = {
    kind: "group",
    agentId: agent.id,
    conversationId: group.id,
  };
  const model = group.agentModels?.[agent.id];
  return {
    control: {
      target,
      canControl: group.canControlSessions === true,
      ...(model ? { model } : {}),
      onOpenModel: (entry) => links.onOpenModel(entry, target),
      onRemove: (entry) =>
        links.onRemove({
          id: entry.id,
          name: entry.name,
          kind: "agent",
          brief: group.agentSessions?.find(
            (session) => session.agentId === entry.id,
          ),
          ...(model ? { model } : {}),
        }),
      canRemove: group.isOwner === true,
    },
    onOpenSettings: links.onOpenSettings,
    onOpenDirect:
      onSelect !== undefined && hasDirectChat
        ? (participant) => onSelect({ kind: "participant", id: participant.id })
        : undefined,
    onMention:
      onMention === undefined
        ? undefined
        : (participant) => onMention(participant.username),
  };
}

/** Whether the opened stored conversation is muted and confidential, and the changes of both. */
type MuteControl = ChatMenuSwitches;

/**
 * The access level of an agent as a label; YOLO stands out in the
 * destructive color, so nobody overlooks that Pages does not restrict it.
 */
function AccessBadge({
  participant,
}: {
  readonly participant: VirtualParticipant;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const level = participant.accessLevel;
  if (participant.kind !== "agent" || level === undefined) return null;
  const tone: Readonly<Record<typeof level, string>> = {
    read_only: "border-border bg-surface text-muted-foreground",
    workspace: "border-info/40 bg-info-subtle text-info",
    yolo: "border-destructive bg-destructive font-semibold text-primary-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${tone[level]}`}
      title={t(`agentEmployees.access.hint.${level}`)}
    >
      {level === "yolo" ? (
        <TriangleAlert aria-hidden="true" className="size-3.5" />
      ) : null}
      {t("chatPage.accessLabel", {
        level: t(`agentEmployees.access.${level}`),
      })}
    </span>
  );
}

/** The menu of the agent of a direct chat: the person who talks with it may always steer it. */
function directAgentOptions(
  links: HeaderLinks,
  participant: VirtualParticipant,
): AgentMenuOptions {
  const target: AgentChatControlTarget = {
    kind: "direct",
    agentId: participant.id,
  };
  return {
    onOpenSettings: links.onOpenSettings,
    control: {
      target,
      canControl: true,
      ...(participant.chatModel ? { model: participant.chatModel } : {}),
      onOpenModel: (agent) => links.onOpenModel(agent, target),
    },
  };
}

function ParticipantHeader({
  participant,
  isAnswering,
  onStop,
  mute,
  links,
}: {
  readonly participant: VirtualParticipant;
  readonly isAnswering: boolean;
  readonly onStop: () => void;
  readonly mute: MuteControl;
  readonly links: HeaderLinks;
}): React.ReactElement {
  const { t } = useTranslation();
  const menu = useAgentMenuState();
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const isAgent = participant.kind === "agent";
  const facts = [
    participantSubtitle(participant, t),
    t(`chatPage.kind.${participant.kind}`),
    t(`chatPage.status.${participant.status}`),
  ].filter((fact) => fact !== "");
  return (
    <HeaderFrame
      avatar={<ParticipantAvatar participant={participant} size={40} />}
      title={participant.name}
      subtitle={facts.join(" · ")}
      onContextMenu={isAgent ? menu.openFromContextMenu : undefined}
      aside={
        <>
          <AccessBadge participant={participant} />
          {isAgent ? (
            <>
              <ChatModelBadge model={participant.chatModel} />
              <AgentSessionStatus brief={participant.session} />
              <ChatPageAgentButton
                agent={participant}
                brief={participant.session}
                options={{
                  ...directAgentOptions(links, participant),
                  onOpenTasks: () => setIsTasksOpen(true),
                }}
                state={menu}
              />
              <ChatPageScheduledTasks
                chat={{
                  kind: "direct",
                  agentId: participant.id,
                  name: participant.name,
                }}
                isOpen={isTasksOpen}
                onOpenChange={setIsTasksOpen}
              />
            </>
          ) : null}
          {isAnswering && isAgent ? (
            <Button onClick={onStop} size="sm" type="button" variant="outline">
              <Square aria-hidden="true" className="size-3.5" />
              {t("chatPage.stop")}
            </Button>
          ) : null}
          <DirectChatMenu
            participant={participant}
            switches={mute}
            onOpenModel={links.onOpenModel}
          />
        </>
      }
    />
  );
}

/** A person among the member chips; the creator of the group removes one from its menu. */
function MemberChip({
  member,
  onRemove,
}: {
  readonly member: VirtualParticipant;
  /** Absent for everybody but the creator of the group. */
  readonly onRemove?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-1 text-[13px] text-foreground shadow-xs">
      <ParticipantAvatar participant={member} size={22} />
      {member.name}
    </span>
  );
  if (onRemove === undefined) return <li>{chip}</li>;
  return (
    <li>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            onContextMenu={(event) => {
              event.preventDefault();
              setIsOpen(true);
            }}
          >
            {chip}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <ChatPageMenuEntry
            icon={UserMinus}
            label={t("chatPage.agentMenu.remove")}
            isDestructive
            onSelect={onRemove}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** One stop button per agent answering in the group; each stops only its own answer. */
function GroupStopButtons({
  group,
  onStopAgent,
}: {
  readonly group: VirtualGroup;
  readonly onStopAgent: (agentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {(group.workingAgents ?? []).map((agent) => (
        <Button
          key={agent.id}
          onClick={() => onStopAgent(agent.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Square aria-hidden="true" className="size-3.5" />
          {t("chatPage.stopAgent", { name: agent.name })}
        </Button>
      ))}
    </>
  );
}

interface GroupHeaderProps {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly participants: readonly VirtualParticipant[];
  readonly onAddMember: (groupId: string, participantId: string) => void;
  readonly onStopAgent: ((agentId: string) => void) | undefined;
  readonly mute: MuteControl;
  readonly links: HeaderLinks;
}

/** The members as chips: an agent opens its menu, a person is only named. */
function MemberChips({
  group,
  members,
  participants,
  links,
}: Pick<
  GroupHeaderProps,
  "group" | "members" | "participants" | "links"
>): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("chatPage.members")} className="flex flex-wrap gap-2">
      {members.map((member) =>
        member.kind === "agent" ? (
          <ChatPageAgentChip
            key={member.id}
            agent={member}
            brief={group.agentSessions?.find(
              (session) => session.agentId === member.id,
            )}
            options={groupAgentOptions(links, group, participants, member)}
          />
        ) : (
          <MemberChip
            key={member.id}
            member={member}
            onRemove={
              group.isOwner === true
                ? () =>
                    links.onRemove({
                      id: member.id,
                      name: member.name,
                      kind: "human",
                    })
                : undefined
            }
          />
        ),
      )}
    </ul>
  );
}

function GroupHeader({
  group,
  members,
  participants,
  onAddMember,
  onStopAgent,
  mute,
  links,
}: GroupHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<GroupDialogKind | null>(null);
  if (group.isAgentConversation === true)
    return (
      <HeaderFrame
        avatar={<GroupAvatars members={members} size="header" />}
        title={group.name}
        subtitle={t("chatPage.agentConversationSubtitle")}
        aside={
          <>
            <AgentConversationBadge group={group} />
            <GroupChatMenu
              group={group}
              members={members}
              switches={mute}
              onOpenDialog={setDialog}
              onOpenModel={links.onOpenModel}
            />
          </>
        }
      />
    );
  return (
    <>
      <HeaderFrame
        avatar={<GroupAvatars members={members} size="header" />}
        title={group.name}
        subtitle={t("chatPage.groupSubtitle", {
          description: group.description,
        })}
        aside={
          <>
            <MemberChips
              group={group}
              members={members}
              participants={participants}
              links={links}
            />
            {onStopAgent ? (
              <GroupStopButtons group={group} onStopAgent={onStopAgent} />
            ) : null}
            <GroupChatMenu
              group={group}
              members={members}
              switches={mute}
              onOpenDialog={setDialog}
              onOpenModel={links.onOpenModel}
            />
          </>
        }
      />
      <ChatPageGroupDialogs
        group={group}
        members={members}
        participants={participants}
        onAddMember={onAddMember}
        onRemoveMember={links.onRemove}
        dialog={dialog}
        onDialogChange={setDialog}
        onOpenSettings={links.onOpenSettings}
      />
    </>
  );
}

/** An agent's head as the popup shows it before the sessions arrive. */
function agentIdentity(agent: VirtualParticipant): AgentSettingsIdentity {
  return {
    name: agent.name,
    subtitle: agent.role,
    color: agent.color,
    avatarImageUrl: agent.avatarImageUrl,
  };
}

/**
 * The chat the popup opens from, for its table: the group, or the session of
 * the direct chat with the agent (whose chat ID is the person's own).
 */
function currentChatOf(
  opened: OpenedConversation,
): AgentSettingsCurrentChat | undefined {
  if (opened.kind === "group") return { kind: "group", id: opened.group.id };
  const sessionId = opened.participant.session?.sessionId;
  return sessionId === undefined ? undefined : { sessionId };
}

/** The agent and chat the choice "Modell in diesem Chat …" is open for. */
interface ModelTarget {
  readonly agent: VirtualParticipant;
  readonly target: AgentChatControlTarget;
}

/** The agent and tab the popup "Agent-Einstellungen" is open for. */
interface SettingsTarget {
  readonly agent: VirtualParticipant;
  readonly tab: AgentSettingsTab;
}

/**
 * The head of the opened conversation, separated from the history by a line.
 *
 * @remarks
 * An agent shows its job title, a person the username, both with their kind
 * and status; a person has no task, model or tools. A stop button shows while
 * an agent answers. A group shows its description and the members as chips,
 * and a stop button for every agent answering in it. The
 * creator removes a member from its chip. An agent whose model in this chat
 * deviates from its own shows the short name of that model.
 * Everything else the chat offers sits in the chat menu ☰ at the right edge
 * of every head: "Medien & Dateien", the group context,
 * the members, who answers, the model per
 * chat, a new session of an agent, the domains released for embedding in a
 * chat with a person, the switches for the confidential mark
 * and muting and the dissolution of a group. A right
 * click on a chat of the list opens the same menu.
 *
 * An agent shows what its session does in this chat, as a word on its chip
 * in a group and next to the button "Agent" in a direct chat. A click or a
 * right click opens its menu: the session buttons, its settings popup, its
 * direct chat and its mention. The one popup "Agent-Einstellungen" belongs to
 * the head, so the menus and the sessions dialog of the group share it.
 * A stored conversation with a person or of a group can be muted for the
 * person alone; a chat with agents can be marked confidential.
 */
export function ChatPageHeader({
  opened,
  participants,
  isAnswering,
  onStop,
  onStopAgent,
  onAddMember,
  onSelect,
  onMention,
  isMuted,
  onToggleMute,
  confidential,
}: MuteControl & {
  readonly opened: OpenedConversation;
  /** The person's own participants, which a group can take. */
  readonly participants: readonly VirtualParticipant[];
  readonly isAnswering: boolean;
  readonly onStop: () => void;
  /** Stops the answer of one agent in the opened group; without it no stop button shows there. */
  readonly onStopAgent?: (agentId: string) => void;
  readonly onAddMember: (groupId: string, participantId: string) => void;
  /** Opens a conversation of the list; without it no menu opens a direct chat. */
  readonly onSelect?: (selection: VirtualChatSelection) => void;
  /** Puts `@username` into the input field; without it no menu offers the mention. */
  readonly onMention?: (username: string) => void;
}): React.ReactElement {
  const mute: MuteControl = { isMuted, onToggleMute, confidential };
  const [target, setTarget] = useState<SettingsTarget | null>(null);
  const [modelFor, setModelFor] = useState<ModelTarget | null>(null);
  const [removal, setRemoval] = useState<RemovalCandidate | null>(null);
  const links: HeaderLinks = {
    onOpenSettings: (agent, tab) => setTarget({ agent, tab }),
    onSelect,
    onMention,
    onOpenModel: (agent, control) => setModelFor({ agent, target: control }),
    onRemove: setRemoval,
  };
  const chatName =
    opened.kind === "group" ? opened.group.name : opened.participant.name;
  return (
    <>
      {opened.kind === "group" ? (
        <GroupHeader
          group={opened.group}
          members={opened.members}
          participants={participants}
          onAddMember={onAddMember}
          onStopAgent={onStopAgent}
          mute={mute}
          links={links}
        />
      ) : (
        <ParticipantHeader
          participant={opened.participant}
          isAnswering={isAnswering}
          onStop={onStop}
          mute={mute}
          links={links}
        />
      )}
      <AgentSettingsDialog
        agentId={target?.agent.id ?? null}
        initialTab={target?.tab}
        identity={target === null ? undefined : agentIdentity(target.agent)}
        currentChat={currentChatOf(opened)}
        onClose={() => setTarget(null)}
      />
      <ChatPageModelDialog
        target={modelFor?.target ?? null}
        agentName={modelFor?.agent.name ?? ""}
        chatName={chatName}
        onClose={() => setModelFor(null)}
      />
      {opened.kind === "group" ? (
        <ChatPageRemoveDialog
          groupId={opened.group.id}
          groupName={opened.group.name}
          member={removal}
          onClose={() => setRemoval(null)}
        />
      ) : null}
    </>
  );
}
