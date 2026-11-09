import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import { useChatActivity } from "./use-chat-activity";

import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
  VirtualChatSendFailure,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** How often the page reads the history again while an agent answers. */
const ANSWER_POLL_MILLISECONDS = 3_000;

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
  /** Groups whose name, description or member names match the search, newest first. */
  readonly groups: readonly VirtualGroup[];
  /** Participants whose name, job title or username matches the search, newest first. */
  readonly participants: readonly VirtualParticipant[];
  /** All groups, whatever the search; the picker below `md` offers them. */
  readonly allGroups: readonly VirtualGroup[];
  /** All participants, whatever the search, newest first. */
  readonly allParticipants: readonly VirtualParticipant[];
  readonly opened: OpenedConversation | null;
  /** The history of the opened conversation, with a message still on its way. */
  readonly messages: readonly VirtualChatMessage[];
  /** Whether the opened agent is answering now. */
  readonly isAnswering: boolean;
  /** Why the last message could not be sent, or `null`. */
  readonly sendFailure: VirtualChatSendFailure | null;
  /** Sends a message to the opened agent, or to the opened group's local history. */
  send(content: string): void;
  /** Adds one of the person's participants to a group. */
  addMember(groupId: string, participantId: string): void;
  /** Stops the answer of the opened agent. */
  stop(): void;
  findParticipant(id: string): VirtualParticipant | undefined;
  /** The known members of a group, in its order. */
  findMembers(group: VirtualGroup): VirtualParticipant[];
}

interface SendResult {
  readonly ok: boolean;
  readonly error?: VirtualChatSendFailure;
}

function isSendResult(value: unknown): value is SendResult {
  return typeof value === "object" && value !== null && "ok" in value;
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

/** The groups and participants of the page in their order. */
interface ChatLists {
  readonly groups: readonly VirtualGroup[];
  readonly participants: readonly VirtualParticipant[];
}

function firstSelection(lists: ChatLists): VirtualChatSelection | null {
  const [group] = lists.groups;
  if (group) return { kind: "group", id: group.id };
  const participant =
    lists.participants.find((entry) => entry.canChat) ?? lists.participants[0];
  return participant ? { kind: "participant", id: participant.id } : null;
}

function openConversation(
  lists: ChatLists,
  selection: VirtualChatSelection | null,
): OpenedConversation | null {
  if (!selection) return null;
  if (selection.kind === "group") {
    const group = lists.groups.find((entry) => entry.id === selection.id);
    return group
      ? {
          kind: "group",
          group,
          members: membersOf(group, lists.participants),
        }
      : null;
  }
  const participant = lists.participants.find(
    (entry) => entry.id === selection.id,
  );
  return participant ? { kind: "participant", participant } : null;
}

/** The message on its way, shown until the history holds it. */
function pendingMessage(
  formData: FormData | undefined,
  selection: VirtualChatSelection | null,
): VirtualChatMessage | null {
  const text = formData?.get("text");
  const agentId = formData?.get("agentId");
  if (typeof text !== "string" || agentId !== selection?.id) return null;
  return { id: "pending", authorId: null, content: text, toolUses: [] };
}

/** Reads the history again while the opened agent answers. */
function useAnswerPolling(isAnswering: boolean): void {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isAnswering) return undefined;
    const timer = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, ANSWER_POLL_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [isAnswering, revalidator]);
}

/** Groups and participants that match the search in the fields of PAGE-259. */
function searchLists(lists: ChatLists, query: string): ChatLists {
  return {
    groups: lists.groups.filter((group) =>
      matches(
        [
          group.name,
          group.description,
          ...membersOf(group, lists.participants).map((member) => member.name),
        ],
        query,
      ),
    ),
    participants: lists.participants.filter((participant) =>
      matches(
        [participant.name, participant.role, participant.username],
        query,
      ),
    ),
  };
}

/**
 * Selection, search and the conversation with agents and groups on the chat
 * page.
 *
 * @remarks
 * Both lists come newest activity first; the first group opens at first,
 * else the first agent of the list. A sent message goes to the agent over the
 * page's action and shows at once; the page reads the history again until
 * the agent's answer is stored. A message to a group stays in this visit's
 * history and only moves the group up (PAGE-259).
 */
export function useChatPage(directory: VirtualChatDirectory): ChatPageState {
  const [query, setQuery] = useState("");
  const activity = useChatActivity(directory);
  const lists: ChatLists = activity;
  const [selection, setSelection] = useState(() => firstSelection(lists));
  const sender = useFetcher();
  const stopper = useFetcher();

  const found = searchLists(lists, query);
  const opened = openConversation(lists, selection);
  const historyId = selection?.id ?? "";
  const pending = pendingMessage(sender.formData, selection);
  const stored =
    selection?.kind === "group"
      ? (activity.groupMessages[historyId] ?? [])
      : (directory.histories[historyId] ?? []);
  const messages = pending ? [...stored, pending] : stored;
  const isAnswering =
    pending !== null ||
    (opened?.kind === "participant" && opened.participant.status === "working");
  const result: unknown = sender.data;
  const sendFailure =
    sender.state === "idle" && isSendResult(result) && !result.ok
      ? (result.error ?? "invalidInput")
      : null;
  useAnswerPolling(isAnswering);

  function send(content: string): void {
    if (content.trim() === "" || !opened) return;
    if (opened.kind === "group") {
      activity.sendToGroup(opened.group.id, content);
      return;
    }
    if (!opened.participant.canChat) return;
    const formData = new FormData();
    formData.set("intent", "send");
    formData.set("agentId", opened.participant.id);
    formData.set("text", content);
    formData.set("clientMessageId", crypto.randomUUID());
    activity.touch({ kind: "participant", id: opened.participant.id });
    void sender.submit(formData, { method: "post" });
  }

  function stop(): void {
    if (opened?.kind !== "participant") return;
    const formData = new FormData();
    formData.set("intent", "stop");
    formData.set("agentId", opened.participant.id);
    void stopper.submit(formData, { method: "post" });
  }

  function findParticipant(id: string): VirtualParticipant | undefined {
    return lists.participants.find((participant) => participant.id === id);
  }

  function findMembers(group: VirtualGroup): VirtualParticipant[] {
    return membersOf(group, lists.participants);
  }

  return {
    query,
    setQuery,
    selection,
    select: setSelection,
    groups: found.groups,
    participants: found.participants,
    allGroups: lists.groups,
    allParticipants: lists.participants,
    opened,
    messages,
    isAnswering,
    sendFailure,
    send,
    addMember: activity.addMember,
    stop,
    findParticipant,
    findMembers,
  };
}
