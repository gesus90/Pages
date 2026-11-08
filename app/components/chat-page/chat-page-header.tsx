import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { GroupAvatars, ParticipantAvatar } from "./chat-page-avatar";

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
}: {
  readonly participant: VirtualParticipant;
}): React.ReactElement {
  const { t } = useTranslation();
  const facts = [
    participant.role,
    participant.model,
    participant.tools.join(", "),
  ].filter((fact) => fact !== "");
  return (
    <HeaderFrame
      avatar={<ParticipantAvatar participant={participant} size={40} />}
      title={participant.name}
      subtitle={facts.join(" · ")}
      aside={
        <p className="rounded-[10px] bg-surface px-3 py-1.5 text-xs text-foreground shadow-xs">
          <span className="text-muted-foreground">{t("chatPage.task")}</span>{" "}
          {participant.task}
        </p>
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
}: {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
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
          {/* Adding members follows with the stored groups; until then the control only shows where it will be. */}
          <button
            aria-disabled="true"
            aria-label={t("chatPage.addMember")}
            className="inline-flex size-7 items-center justify-center rounded-full border-[1.5px] border-dashed border-current text-muted-foreground"
            title={t("chatPage.comingSoon")}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        </>
      }
    />
  );
}

/**
 * The head of the opened conversation, separated from the history by a line.
 *
 * @remarks
 * A participant shows role, model and tools and the task at the right; a
 * group shows its description and the members as chips.
 */
export function ChatPageHeader({
  opened,
}: {
  readonly opened: OpenedConversation;
}): React.ReactElement {
  if (opened.kind === "group")
    return <GroupHeader group={opened.group} members={opened.members} />;
  return <ParticipantHeader participant={opened.participant} />;
}
