import { useState } from "react";

import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** The opened group or participant with what its view shows. */
export type OpenedConversation =
  | {
      readonly kind: "group";
      readonly group: VirtualGroup;
      readonly members: readonly VirtualParticipant[];
    }
  | { readonly kind: "participant"; readonly participant: VirtualParticipant };

/** State and derived values of the chat page. */
export interface ChatPageState {
  readonly query: string;
  setQuery(query: string): void;
  readonly selection: VirtualChatSelection | null;
  select(selection: VirtualChatSelection): void;
  /** Groups whose name or shown member names match the search. */
  readonly groups: readonly VirtualGroup[];
  /** Participants whose name or role matches the search. */
  readonly participants: readonly VirtualParticipant[];
  /** All groups, whatever the search; the picker below `md` offers them. */
  readonly allGroups: readonly VirtualGroup[];
  /** All participants, whatever the search. */
  readonly allParticipants: readonly VirtualParticipant[];
  readonly opened: OpenedConversation | null;
  /** The history of the opened conversation, with the locally sent messages. */
  readonly messages: readonly VirtualChatMessage[];
  /** Appends a message to the opened history; nothing is stored (PAGE-254). */
  send(content: string): void;
  findParticipant(id: string): VirtualParticipant | undefined;
  /** The known members of a group, in its order. */
  findMembers(group: VirtualGroup): VirtualParticipant[];
}

function matches(texts: readonly string[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return texts.some((text) => text.toLocaleLowerCase().includes(needle));
}

function membersOf(
  group: VirtualGroup,
  participants: readonly VirtualParticipant[],
): VirtualParticipant[] {
  return group.memberIds.flatMap((id) => {
    const member = participants.find((participant) => participant.id === id);
    return member ? [member] : [];
  });
}

function firstSelection(
  directory: VirtualChatDirectory,
): VirtualChatSelection | null {
  const [group] = directory.groups;
  if (group) return { kind: "group", id: group.id };
  const [participant] = directory.participants;
  return participant ? { kind: "participant", id: participant.id } : null;
}

function openConversation(
  directory: VirtualChatDirectory,
  selection: VirtualChatSelection | null,
): OpenedConversation | null {
  if (!selection) return null;
  if (selection.kind === "group") {
    const group = directory.groups.find((entry) => entry.id === selection.id);
    return group
      ? {
          kind: "group",
          group,
          members: membersOf(group, directory.participants),
        }
      : null;
  }
  const participant = directory.participants.find(
    (entry) => entry.id === selection.id,
  );
  return participant ? { kind: "participant", participant } : null;
}

/**
 * Selection, search and the local history of the chat page.
 *
 * @remarks
 * The first group opens at first, else the first participant; an empty
 * directory opens nothing. Sent messages live only in this state until a
 * later ticket stores histories.
 */
export function useChatPage(directory: VirtualChatDirectory): ChatPageState {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(() => firstSelection(directory));
  const [sent, setSent] = useState<
    Readonly<Record<string, readonly VirtualChatMessage[]>>
  >({});

  const groups = directory.groups.filter((group) =>
    matches(
      [
        group.name,
        ...membersOf(group, directory.participants).map(
          (member) => member.name,
        ),
      ],
      query,
    ),
  );
  const participants = directory.participants.filter((participant) =>
    matches([participant.name, participant.role], query),
  );
  const opened = openConversation(directory, selection);
  const historyId = selection?.id ?? "";
  const messages = [
    ...(directory.histories[historyId] ?? []),
    ...(sent[historyId] ?? []),
  ];

  function send(content: string): void {
    if (!selection || content.trim() === "") return;
    const message: VirtualChatMessage = {
      id: `local-${selection.id}-${messages.length}`,
      authorId: null,
      content,
      toolUses: [],
    };
    setSent((current) => ({
      ...current,
      [selection.id]: [...(current[selection.id] ?? []), message],
    }));
  }

  function findParticipant(id: string): VirtualParticipant | undefined {
    return directory.participants.find((participant) => participant.id === id);
  }

  function findMembers(group: VirtualGroup): VirtualParticipant[] {
    return membersOf(group, directory.participants);
  }

  return {
    query,
    setQuery,
    selection,
    select: setSelection,
    groups,
    participants,
    allGroups: directory.groups,
    allParticipants: directory.participants,
    opened,
    messages,
    send,
    findParticipant,
    findMembers,
  };
}
