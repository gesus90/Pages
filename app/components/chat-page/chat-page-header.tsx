import { Bell, BellOff, Square, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";
import { ConfidentialButton } from "./chat-page-confidential";
import { participantSubtitle } from "./chat-page-list-entries";
import { ChatPageMemberDialog } from "./chat-page-member-dialog";

import type { ReactNode } from "react";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { ConfidentialControl } from "./chat-page-confidential";
import type { OpenedConversation } from "./use-chat-page";

function HeaderFrame({
  avatar,
  title,
  subtitle,
  aside,
}: {
  readonly avatar: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly aside: ReactNode;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-4">
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-xl font-semibold text-foreground">
          {title}
        </h2>
        <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{aside}</div>
    </header>
  );
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
}: {
  readonly participant: VirtualParticipant;
  readonly isAnswering: boolean;
  readonly onStop: () => void;
  readonly mute: MuteControl;
}): React.ReactElement {
  const { t } = useTranslation();
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
      aside={
        <>
          <AccessBadge participant={participant} />
          <ConfidentialButton control={mute.confidential} />
          <MuteButton {...mute} />
          {isAnswering && participant.kind === "agent" ? (
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

function GroupHeader({
  group,
  members,
  participants,
  onAddMember,
  onStopAgent,
  mute,
}: {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly participants: readonly VirtualParticipant[];
  readonly onAddMember: (groupId: string, participantId: string) => void;
  readonly onStopAgent: ((agentId: string) => void) | undefined;
  readonly mute: MuteControl;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HeaderFrame
      avatar={<GroupAvatars members={members} size="header" />}
      title={group.name}
      subtitle={t("chatPage.groupSubtitle", {
        description: group.description,
      })}
      aside={
        <>
          <ul
            aria-label={t("chatPage.members")}
            className="flex flex-wrap gap-2"
          >
            {members.map((member) => (
              <MemberChip key={member.id} member={member} />
            ))}
          </ul>
          <ChatPageMemberDialog
            group={group}
            participants={participants}
            onAdd={onAddMember}
          />
          <ConfidentialButton control={mute.confidential} />
          <MuteButton {...mute} />
          {onStopAgent ? (
            <GroupStopButtons group={group} onStopAgent={onStopAgent} />
          ) : null}
        </>
      }
    />
  );
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
 * A stored conversation with a person or of a group can be muted for the
 * person alone (PAGE-275); a chat with an agent and a group can be marked
 * confidential (PAGE-305).
 */
export function ChatPageHeader({
  opened,
  participants,
  isAnswering,
  onStop,
  onStopAgent,
  onAddMember,
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
}): React.ReactElement {
  const mute: MuteControl = { isMuted, onToggleMute, confidential };
  if (opened.kind === "group")
    return (
      <GroupHeader
        group={opened.group}
        members={opened.members}
        participants={participants}
        onAddMember={onAddMember}
        onStopAgent={onStopAgent}
        mute={mute}
      />
    );
  return (
    <ParticipantHeader
      participant={opened.participant}
      isAnswering={isAnswering}
      onStop={onStop}
      mute={mute}
    />
  );
}
