import { Bell, BellOff, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";
import { ChatPageEmbedDomainsButton } from "./chat-page-embed-domains";
import { ChatPageGroupContext } from "./chat-page-group-context";
import { participantSubtitle } from "./chat-page-list-entries";
import { ChatPageMemberDialog } from "./chat-page-member-dialog";

import type { ReactNode } from "react";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
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
}

/** Mutes or unmutes the conversation for the person alone (PAGE-275). */
function MuteButton({
  isMuted,
  onToggleMute,
}: MuteControl): React.ReactElement | null {
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
          {participant.kind === "agent" ? null : <ChatPageEmbedDomainsButton />}
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

function GroupHeader({
  group,
  members,
  participants,
  onAddMember,
  mute,
}: {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly participants: readonly VirtualParticipant[];
  readonly onAddMember: (groupId: string, participantId: string) => void;
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
          <ChatPageGroupContext group={group} />
          <MuteButton {...mute} />
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
 * the dashed plus that adds one of the person's participants (PAGE-259)
 * and its stored context (PAGE-296).
 * A stored conversation with a person or of a group can be muted for the
 * person alone (PAGE-275). Its settings list the domains released for
 * embedding (PAGE-298): in the member dialog of a group, behind a button of
 * their own in a conversation with a person.
 */
export function ChatPageHeader({
  opened,
  participants,
  isAnswering,
  onStop,
  onAddMember,
  isMuted,
  onToggleMute,
}: MuteControl & {
  readonly opened: OpenedConversation;
  /** The person's own participants, which a group can take. */
  readonly participants: readonly VirtualParticipant[];
  readonly isAnswering: boolean;
  readonly onStop: () => void;
  readonly onAddMember: (groupId: string, participantId: string) => void;
}): React.ReactElement {
  const mute: MuteControl = { isMuted, onToggleMute };
  if (opened.kind === "group")
    return (
      <GroupHeader
        group={opened.group}
        members={opened.members}
        participants={participants}
        onAddMember={onAddMember}
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
