import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ParticipantAvatar } from "./chat-page-avatar";
import { ChatPageOpenedEmbedDomains } from "./chat-page-embed-domains";
import { participantSubtitle } from "./chat-page-list-entries";

import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

function matches(participant: VirtualParticipant, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return (
    needle === "" ||
    [participant.name, participant.role, participant.username].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    )
  );
}

function CandidateList({
  candidates,
  hasCandidates,
  onChoose,
}: {
  readonly candidates: readonly VirtualParticipant[];
  readonly hasCandidates: boolean;
  readonly onChoose: (participantId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (!hasCandidates)
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {t("chatPage.memberDialog.allMembers")}
      </p>
    );
  if (candidates.length === 0)
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {t("chatPage.noMatches")}
      </p>
    );
  return (
    <ul className="flex flex-col">
      {candidates.map((participant) => (
        <li key={participant.id}>
          <button
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => onChoose(participant.id)}
            type="button"
          >
            <ParticipantAvatar participant={participant} size={32} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold text-foreground">
                {participant.name}
              </span>
              <span className="truncate text-[13px] text-muted-foreground">
                {participantSubtitle(participant, t)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface ChatPageMemberDialogProps {
  readonly group: VirtualGroup;
  /** The person's own participants. */
  readonly participants: readonly VirtualParticipant[];
  readonly onAdd: (groupId: string, participantId: string) => void;
}

/**
 * The dashed plus in the head of a group and the searchable choice it opens
 * (PAGE-259): the person's own participants that are not yet members.
 *
 * @remarks
 * Choosing one adds it at once and stores it; the dialog closes and the
 * chips show the new member. When everyone is a member already, the choice
 * says so. Below the choice the dialog lists the domains released for
 * embedding in the group's conversation (PAGE-298).
 */
export function ChatPageMemberDialog({
  group,
  participants,
  onAdd,
}: ChatPageMemberDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = participants.filter(
    (participant) => !group.memberIds.includes(participant.id),
  );
  const candidates = available.filter((participant) =>
    matches(participant, query),
  );

  function handleOpenChange(open: boolean): void {
    setIsOpen(open);
    if (!open) setQuery("");
  }

  function handleChoose(participantId: string): void {
    onAdd(group.id, participantId);
    handleOpenChange(false);
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("chatPage.addMember")}
        className="inline-flex size-7 items-center justify-center rounded-full border-[1.5px] border-dashed border-current text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        onClick={() => setIsOpen(true)}
        title={t("chatPage.addMember")}
        type="button"
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
      <Dialog onOpenChange={handleOpenChange} open={isOpen}>
        <DialogContent size="sm">
          <DialogTitle className="text-lg font-semibold">
            {t("chatPage.memberDialog.title", { name: group.name })}
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("chatPage.memberDialog.description")}
          </DialogDescription>
          <label className="relative mt-4 block">
            <span className="sr-only">{t("chatPage.memberDialog.search")}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("chatPage.memberDialog.search")}
              type="search"
              value={query}
            />
          </label>
          <div className="mt-3 max-h-[50dvh] overflow-y-auto">
            <CandidateList
              candidates={candidates}
              hasCandidates={available.length > 0}
              onChoose={handleChoose}
            />
          </div>
          <div className="mt-4 border-t border-border pt-4 empty:hidden">
            <ChatPageOpenedEmbedDomains />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
