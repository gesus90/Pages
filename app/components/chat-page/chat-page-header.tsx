import { Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";
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

function ParticipantHeader({
  participant,
  isAnswering,
  onStop,
}: {
  readonly participant: VirtualParticipant;
  readonly isAnswering: boolean;
  readonly onStop: () => void;
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
        isAnswering && participant.kind === "agent" ? (
          <Button onClick={onStop} size="sm" type="button" variant="outline">
            <Square aria-hidden="true" className="size-3.5" />
            {t("chatPage.stop")}
          </Button>
        ) : null
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
}: {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly participants: readonly VirtualParticipant[];
  readonly onAddMember: (groupId: string, participantId: string) => void;
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
 * the dashed plus that adds one of the person's participants (PAGE-259).
 */
export function ChatPageHeader({
  opened,
  participants,
  isAnswering,
  onStop,
  onAddMember,
}: {
  readonly opened: OpenedConversation;
  /** The person's own participants, which a group can take. */
  readonly participants: readonly VirtualParticipant[];
  readonly isAnswering: boolean;
  readonly onStop: () => void;
  readonly onAddMember: (groupId: string, participantId: string) => void;
}): React.ReactElement {
  if (opened.kind === "group")
    return (
      <GroupHeader
        group={opened.group}
        members={opened.members}
        participants={participants}
        onAddMember={onAddMember}
      />
    );
  return (
    <ParticipantHeader
      participant={opened.participant}
      isAnswering={isAnswering}
      onStop={onStop}
    />
  );
}
