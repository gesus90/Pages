import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ChatModelBadge } from "./chat-page-agent-triggers";
import { ParticipantAvatar } from "./chat-page-avatar";
import { ChatPageOpenedEmbedDomains } from "./chat-page-embed-domains";
import { CandidateList, matchesParticipant } from "./chat-page-member-dialog";
import { sendAgentControl } from "./agent-control-api";
import { useAgentControl } from "./use-agent-control";

import type {
  ChatGroupMemberView,
  ChatGroupMembersView,
} from "@/definition/AgentChatControl";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { RemovalCandidate } from "./chat-page-remove-dialog";

interface ChatPageGroupMembersProps {
  readonly group: VirtualGroup;
  /** The person's own participants, which the creator can add. */
  readonly participants: readonly VirtualParticipant[];
  readonly onAdd: (groupId: string, participantId: string) => void;
  /** Asks to remove a member; the question is a dialog of its own. */
  readonly onRemove: (member: RemovalCandidate) => void;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** Reads the members of the group whenever the dialog opens or its member list changes. */
function useGroupMembers(
  group: VirtualGroup,
  isOpen: boolean,
): {
  readonly view: ChatGroupMembersView | null;
  setView(view: ChatGroupMembersView): void;
} {
  const [view, setView] = useState<ChatGroupMembersView | null>(null);
  const groupId = group.id;
  const membersKey = group.memberIds.join(",");
  useEffect(() => {
    if (!isOpen || membersKey === undefined) return undefined;
    let isCurrent = true;
    sendAgentControl({ intent: "members", groupId })
      .then((response) => {
        if (isCurrent && response.ok && response.members)
          setView(response.members);
      })
      .catch((error: unknown) => {
        console.warn(
          "[pages] The members of the group could not be read.",
          error,
        );
      });
    return () => {
      isCurrent = false;
    };
  }, [isOpen, groupId, membersKey]);
  return { view, setView };
}

function MemberRow({
  member,
  view,
  onToggleControl,
  onRemove,
}: {
  readonly member: ChatGroupMemberView;
  readonly view: ChatGroupMembersView;
  readonly onToggleControl: (member: ChatGroupMemberView) => void;
  readonly onRemove: (member: ChatGroupMemberView) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const participant = {
    name: member.name,
    color: member.color,
    avatarImageUrl: member.avatarImageUrl,
    kind: member.kind,
  };
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0">
      <ParticipantAvatar participant={participant} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {member.name}
          {member.isOwner ? (
            <span className="rounded-full bg-primary-subtle px-1.5 text-[11px] font-normal text-primary">
              {t("chatPage.groupMembers.owner")}
            </span>
          ) : null}
          <ChatModelBadge model={member.model} />
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {member.role === "" ? t(`chatPage.kind.${member.kind}`) : member.role}
        </span>
      </span>
      <ControlCell
        member={member}
        canManage={view.canManage}
        onToggle={onToggleControl}
      />
      {view.canManage && !member.isOwner ? (
        <Button size="sm" variant="outline" onClick={() => onRemove(member)}>
          {t("chatPage.groupMembers.remove")}
        </Button>
      ) : null}
    </li>
  );
}

/** "Darf Modell & Sitzungen steuern": always the creator, never an agent, a box for every other person. */
function ControlCell({
  member,
  canManage,
  onToggle,
}: {
  readonly member: ChatGroupMemberView;
  readonly canManage: boolean;
  readonly onToggle: (member: ChatGroupMemberView) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (member.isOwner)
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatPage.groupMembers.controlOwner")}
      </span>
    );
  if (member.kind === "agent")
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatPage.groupMembers.controlAgent")}
      </span>
    );
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={member.canControl}
        disabled={!canManage}
        onChange={() => onToggle(member)}
      />
      {t("chatPage.groupMembers.control")}
    </label>
  );
}

/** The search and list of the person's participants the creator can add. */
function AddMembers({
  group,
  participants,
  onAdd,
}: Pick<
  ChatPageGroupMembersProps,
  "group" | "participants" | "onAdd"
>): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const available = participants.filter(
    (participant) => !group.memberIds.includes(participant.id),
  );
  return (
    <section className="mt-4">
      <label className="relative block">
        <span className="sr-only">{t("chatPage.memberDialog.search")}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chatPage.groupMembers.addPlaceholder")}
          type="search"
          value={query}
        />
      </label>
      {query.trim() === "" ? null : (
        <div className="mt-2 max-h-48 overflow-y-auto">
          <CandidateList
            candidates={available.filter((participant) =>
              matchesParticipant(participant, query),
            )}
            hasCandidates={available.length > 0}
            onChoose={(participantId) => {
              onAdd(group.id, participantId);
              setQuery("");
            }}
          />
        </div>
      )}
    </section>
  );
}

/**
 * "Mitglieder" of the group menu (PAGE-380): every person and agent of the
 * group, who may steer its agents, "Entfernen" and the field that adds a
 * participant for the creator. The dashed plus of the head moved here.
 */
export function ChatPageGroupMembers({
  group,
  participants,
  onAdd,
  onRemove,
  isOpen,
  onOpenChange,
}: ChatPageGroupMembersProps): React.ReactElement {
  const { t } = useTranslation();
  const { view, setView } = useGroupMembers(group, isOpen);
  const request = useAgentControl();

  async function handleToggleControl(
    member: ChatGroupMemberView,
  ): Promise<void> {
    if (view === null) return;
    const allowed = view.members
      .filter((entry) => !entry.isOwner && entry.kind === "human")
      .filter((entry) =>
        entry.id === member.id ? !entry.canControl : entry.canControl,
      )
      .map((entry) => entry.id);
    const response = await request.send({
      intent: "save-controllers",
      groupId: group.id,
      userIds: JSON.stringify(allowed),
    });
    if (response?.ok === true && response.members) setView(response.members);
  }

  function handleRemove(member: ChatGroupMemberView): void {
    onRemove({
      id: member.id,
      name: member.name,
      kind: member.kind,
      brief: group.agentSessions?.find((entry) => entry.agentId === member.id),
      model: member.model,
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.groupMembers.title", { name: group.name })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {view?.canManage === true
            ? t("chatPage.groupMembers.ownerDescription")
            : t("chatPage.groupMembers.memberDescription")}
        </DialogDescription>
        {view?.canManage === true ? (
          <AddMembers group={group} participants={participants} onAdd={onAdd} />
        ) : null}
        {view === null ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("chatPage.modelChoice.loading")}
          </p>
        ) : (
          <ul className="mt-4 max-h-[50dvh] overflow-y-auto">
            {view.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                view={view}
                onToggleControl={(entry) => void handleToggleControl(entry)}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("chatPage.groupMembers.knowledgeHint")}
        </p>
        {request.failure === null ? null : (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`chatPage.control.failure.${request.failure}`)}
          </p>
        )}
        <div className="mt-4 border-t border-border pt-4 empty:hidden">
          <ChatPageOpenedEmbedDomains />
        </div>
      </DialogContent>
    </Dialog>
  );
}
