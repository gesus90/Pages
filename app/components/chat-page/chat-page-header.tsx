import { Bell, BellOff, Square, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { Button } from "@/app/components/ui/button";

import { AgentSessionStatus } from "./chat-page-agent-status";
import { useAgentMenuState } from "./chat-page-agent-menu";
import {
  ChatPageAgentButton,
  ChatPageAgentChip,
} from "./chat-page-agent-triggers";
import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";
import { ConfidentialButton } from "./chat-page-confidential";
import { ChatPageEmbedDomainsButton } from "./chat-page-embed-domains";
import { ChatPageGroupDialogs } from "./chat-page-group-dialogs";
import { ChatPageGroupMenu } from "./chat-page-group-menu";
import {
  AgentConversationBadge,
  participantSubtitle,
} from "./chat-page-list-entries";
import { ChatPageAddMemberButton } from "./chat-page-member-dialog";

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
import type { AgentMenuOptions } from "./chat-page-agent-menu";
import type { ConfidentialControl } from "./chat-page-confidential";
import type { GroupDialogKind } from "./chat-page-group-menu";
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
}

/** The menu of an agent chip in a group: its direct chat and mention make sense only there. */
function groupAgentOptions(
  links: HeaderLinks,
  participants: readonly VirtualParticipant[],
  agent: VirtualParticipant,
): AgentMenuOptions {
  const { onSelect, onMention } = links;
  const hasDirectChat = participants.some((entry) => entry.id === agent.id);
  return {
    onOpenSettings: links.onOpenSettings,
    onOpenDirect:
      onSelect !== undefined && hasDirectChat
        ? (target) => onSelect({ kind: "participant", id: target.id })
        : undefined,
    onMention:
      onMention === undefined
        ? undefined
        : (target) => onMention(target.username),
  };
}

/** Whether the opened stored conversation is muted, and the change of it. */
interface MuteControl {
  /** `null` when there is nothing to mute, as with an agent. */
  readonly isMuted: boolean | null;
  readonly onToggleMute: () => void;
  /** The confidential mark of a chat with agents (PAGE-305); absent shows none. */
  readonly confidential?: ConfidentialControl;
}

/** Mutes or unmutes the conversation for the person alone (PAGE-275). */
function MuteButton({
  isMuted,
  onToggleMute,
}: Omit<MuteControl, "confidential">): React.ReactElement | null {
  const { t } = useTranslation();
  if (isMuted === null) return null;
  const Icon = isMuted ? BellOff : Bell;
  return (
    <Button
      aria-pressed={isMuted}
      onClick={onToggleMute}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {isMuted ? t("chatPage.unmute") : t("chatPage.mute")}
    </Button>
  );
}

/**
 * The access level of an agent as a label (PAGE-303); YOLO stands out in the
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
              <AgentSessionStatus brief={participant.session} />
              <ChatPageAgentButton
                agent={participant}
                brief={participant.session}
                options={{ onOpenSettings: links.onOpenSettings }}
                state={menu}
              />
            </>
          ) : null}
          <ConfidentialButton control={mute.confidential} />
          {isAgent ? null : <ChatPageEmbedDomainsButton />}
          <MuteButton {...mute} />
          {isAnswering && isAgent ? (
            <Button onClick={onStop} size="sm" type="button" variant="outline">
              <Square aria-hidden="true" className="size-3.5" />
              {t("chatPage.stop")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function MemberChip({
  member,
}: {
  readonly member: VirtualParticipant;
}): React.ReactElement {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-1 text-[13px] text-foreground shadow-xs">
      <ParticipantAvatar participant={member} size={22} />
      {member.name}
    </li>
  );
}

/** One stop button per agent answering in the group; each stops only its own answer (PAGE-304). */
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
            options={groupAgentOptions(links, participants, member)}
          />
        ) : (
          <MemberChip key={member.id} member={member} />
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
        aside={<AgentConversationBadge group={group} />}
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
            <ChatPageAddMemberButton onClick={() => setDialog("members")} />
            <ChatPageGroupMenu
              group={group}
              isMuted={mute.isMuted}
              onToggleMute={mute.onToggleMute}
              confidential={mute.confidential}
              onOpenDialog={setDialog}
            />
            {onStopAgent ? (
              <GroupStopButtons group={group} onStopAgent={onStopAgent} />
            ) : null}
          </>
        }
      />
      <ChatPageGroupDialogs
        group={group}
        members={members}
        participants={participants}
        onAddMember={onAddMember}
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
 * an agent answers. A group shows its description, the members as chips and
 * the dashed plus that adds one of the person's participants (PAGE-259),
 * and a stop button for every agent answering in it (PAGE-304).
 * What the group offers beyond that sits in one menu (PAGE-376): who answers
 * without an @ (PAGE-317), its stored context (PAGE-296), the sessions of its
 * agents, the confidential mark (PAGE-305), muting (PAGE-275) and the
 * members. Its settings list the domains released for embedding (PAGE-298):
 * in the member dialog of a group, behind a button of their own in a
 * conversation with a person.
 *
 * An agent shows what its session does in this chat, as a word on its chip
 * in a group and next to the button "Agent" in a direct chat. A click or a
 * right click opens its menu: the session buttons, its settings popup, its
 * direct chat and its mention. The one popup "Agent-Einstellungen" belongs to
 * the head, so the menus and the sessions dialog of the group share it.
 * A stored conversation with a person or of a group can be muted for the
 * person alone; a chat with an agent can be marked confidential, which a
 * button of the head switches.
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
  const links: HeaderLinks = {
    onOpenSettings: (agent, tab) => setTarget({ agent, tab }),
    onSelect,
    onMention,
  };
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
    </>
  );
}
