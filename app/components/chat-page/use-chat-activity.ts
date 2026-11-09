import { useState } from "react";
import { useFetcher } from "react-router";

import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** The lists of the page in their order, and the changes that reorder them. */
export interface ChatActivity {
  /** The person's participants, the latest activity first. */
  readonly participants: readonly VirtualParticipant[];
  /** The person's groups with a member on its way, the latest activity first. */
  readonly groups: readonly VirtualGroup[];
  /** Messages sent to a group in this visit, by group; they are not stored. */
  readonly groupMessages: Readonly<
    Record<string, readonly VirtualChatMessage[]>
  >;
  /** Moves a conversation to the top at once; the server stores the time. */
  touch(selection: VirtualChatSelection): void;
  /** Adds a message to a group's local history and stores its time. */
  sendToGroup(groupId: string, content: string): void;
  /** Adds one of the person's participants to a group and stores it. */
  addMember(groupId: string, participantId: string): void;
}

function selectionKey(selection: VirtualChatSelection): string {
  return `${selection.kind}:${selection.id}`;
}

function byActivity<Entry extends { readonly lastActivityAt: string }>(
  entries: readonly Entry[],
): Entry[] {
  return [...entries].sort((first, second) =>
    second.lastActivityAt.localeCompare(first.lastActivityAt),
  );
}

/** The member a pending "add-member" adds, for the chips before the answer. */
function pendingMember(
  formData: FormData | undefined,
): { readonly groupId: string; readonly participantId: string } | null {
  const groupId = formData?.get("groupId");
  const participantId = formData?.get("participantId");
  if (typeof groupId !== "string" || typeof participantId !== "string")
    return null;
  return { groupId, participantId };
}

/**
 * Orders participants and groups by their last activity, newest first, and
 * sends the changes that move an entry: a message and a new member.
 *
 * @remarks
 * A sent message moves its conversation up at once; the time the server
 * stores keeps the order after reloading.
 */
export function useChatActivity(directory: VirtualChatDirectory): ChatActivity {
  const [touched, setTouched] = useState<Readonly<Record<string, string>>>({});
  const [groupMessages, setGroupMessages] = useState<
    Readonly<Record<string, readonly VirtualChatMessage[]>>
  >({});
  const groupSender = useFetcher();
  const memberAdder = useFetcher();

  function latest(selection: VirtualChatSelection, stored: string): string {
    const local = touched[selectionKey(selection)];
    return local !== undefined && local > stored ? local : stored;
  }

  const pending = pendingMember(memberAdder.formData);
  const participants = byActivity(
    directory.participants.map((participant) => ({
      ...participant,
      lastActivityAt: latest(
        { kind: "participant", id: participant.id },
        participant.lastActivityAt,
      ),
    })),
  );
  const groups = byActivity(
    directory.groups.map((group) => ({
      ...group,
      memberIds:
        pending?.groupId === group.id &&
        !group.memberIds.includes(pending.participantId)
          ? [...group.memberIds, pending.participantId]
          : group.memberIds,
      lastActivityAt: latest(
        { kind: "group", id: group.id },
        group.lastActivityAt,
      ),
    })),
  );

  function touch(selection: VirtualChatSelection): void {
    const at = new Date().toISOString();
    setTouched((current) => ({ ...current, [selectionKey(selection)]: at }));
  }

  function sendToGroup(groupId: string, content: string): void {
    const message: VirtualChatMessage = {
      id: crypto.randomUUID(),
      authorId: null,
      content,
      toolUses: [],
    };
    setGroupMessages((current) => ({
      ...current,
      [groupId]: [...(current[groupId] ?? []), message],
    }));
    touch({ kind: "group", id: groupId });
    const formData = new FormData();
    formData.set("intent", "send-group");
    formData.set("groupId", groupId);
    void groupSender.submit(formData, { method: "post" });
  }

  function addMember(groupId: string, participantId: string): void {
    const formData = new FormData();
    formData.set("intent", "add-member");
    formData.set("groupId", groupId);
    formData.set("participantId", participantId);
    void memberAdder.submit(formData, { method: "post" });
  }

  return { participants, groups, groupMessages, touch, sendToGroup, addMember };
}
