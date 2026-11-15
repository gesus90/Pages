import { useState } from "react";
import { useFetcher } from "react-router";

import {
  CONVERSATION_PREVIEW_SEND_PREFIX,
  CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS,
} from "@/definition/Conversation";

import { useChatActivity } from "./use-chat-activity";
import { useConversationRead } from "./use-conversation-read";
import { useOlderHistory } from "./use-older-history";
import { useLiveChat } from "./live/use-live-chat";
import { useConversationStream } from "./live/use-conversation-stream";

import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { HistoryLive } from "./chat-page-history";
import type { AgentActivity } from "./live/chat-page-activity-row";
import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
  VirtualChatSendFailure,
  VirtualGroup,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";

/**
 * Sends a stop or a tool cancellation for the opened agent, the stop of
 * one agent's answer in the opened group (PAGE-304), or the release of a
 * paused conversation of agents (PAGE-311).
 */
function useAgentControls(opened: OpenedConversation | null): {
  readonly stop: () => void;
  readonly cancelTool: () => void;
  readonly cancelAgentTool: (agentId: string) => void;
  readonly stopGroupAgent: (agentId: string) => void;
  readonly resumeAgents: () => void;
} {
  const fetcher = useFetcher();
  function submit(intent: "stop" | "cancel-tool"): void {
    if (opened?.kind !== "participant") return;
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("agentId", opened.participant.id);
    void fetcher.submit(formData, { method: "post" });
  }
  function stopGroupAgent(agentId: string): void {
    if (opened?.kind !== "group") return;
    const formData = new FormData();
    formData.set("intent", "stop-group");
    formData.set("groupId", opened.group.id);
    formData.set("agentId", agentId);
    void fetcher.submit(formData, { method: "post" });
  }
  function resumeAgents(): void {
    if (opened?.kind !== "group") return;
    const formData = new FormData();
    formData.set("intent", "resume-agents");
    formData.set("conversationId", opened.group.id);
    void fetcher.submit(formData, { method: "post" });
  }
  // The running tool calls of one agent of the opened chat (PAGE-381).
  function cancelAgentTool(agentId: string): void {
    if (opened?.kind !== "group") {
      submit("cancel-tool");
      return;
    }
    const formData = new FormData();
    formData.set("intent", "cancel-group-tool");
    formData.set("groupId", opened.group.id);
    formData.set("agentId", agentId);
    void fetcher.submit(formData, { method: "post" });
  }
  return {
    stop: () => submit("stop"),
    cancelTool: () => submit("cancel-tool"),
    cancelAgentTool,
    stopGroupAgent,
    resumeAgents,
  };
}

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
  /** Whether older messages of the opened stored conversation can be loaded. */
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  /** Loads the page of messages before the oldest shown one (PAGE-275). */
  loadOlder(): void;
  /**
   * Whether the opened stored conversation is muted for the person; `null`
   * when there is nothing to mute, as with an agent.
   */
  readonly isMuted: boolean | null;
  /** Mutes or unmutes the opened stored conversation for the person alone. */
  toggleMute(): void;
  /** Whether the opened agent, or an agent of the opened group, is answering now. */
  readonly isAnswering: boolean;
  /** Who is answering: the opened agent, or the agents of the opened group (PAGE-276). */
  readonly answeringNames: readonly string[];
  /** The longest voice message Pages takes, in milliseconds (PAGE-277). */
  readonly voiceMaximumMs: number;
  /** Why the last message could not be sent, or `null`. */
  readonly sendFailure: VirtualChatSendFailure | null;
  /**
   * Sends a message to the opened agent, person or group; with uploaded
   * attachments (PAGE-298) the text may be empty. While agents answer,
   * `delivery` puts it into their answers or after them (PAGE-381).
   */
  send(
    content: string,
    attachmentIds?: readonly string[],
    delivery?: ConversationDelivery,
  ): void;
  /**
   * Sends what a preview wrote with `pages.chat.send(text)` as an ordinary
   * message of the person, marked "aus der Vorschau gesendet" (PAGE-383).
   */
  sendFromPreview(text: string): void;
  /** Stops every answer of the opened chat: the agent's, or those of the group's agents (PAGE-381). */
  stopAll(): void;
  /** What the history shows of the answers written now (PAGE-381). */
  readonly live: HistoryLive;
  /** The agents at work in the opened chat and what they do (PAGE-381). */
  readonly activity: readonly AgentActivity[];
  /** Whether the channel of the live answers is open (PAGE-381). */
  readonly isLive: boolean;
  /** Adds one of the person's participants to a group. */
  addMember(groupId: string, participantId: string): void;
  /** Stops the answer of the opened agent. */
  stop(): void;
  /** Stops the answer of one agent in the opened group; the others answer on (PAGE-304). */
  stopGroupAgent(agentId: string): void;
  /** The tool calls of the answer the opened agent is working on (PAGE-303). */
  readonly liveTools: readonly VirtualToolUse[];
  /** Cancels the running tool call of the opened agent; its answer goes on (PAGE-303). */
  cancelTool(): void;
  /** Lets the agents of the opened paused conversation go on (PAGE-311). */
  resumeAgents(): void;
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

/** Why the last message could not be sent, once the sender is idle again. */
function readSendFailure(sender: {
  readonly state: string;
  readonly data: unknown;
}): VirtualChatSendFailure | null {
  const result = sender.data;
  if (sender.state !== "idle" || !isSendResult(result) || result.ok)
    return null;
  return result.error ?? "invalidInput";
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
  if (group.agentMembers) return [...group.agentMembers];
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

/** The stored conversation of the opened entry; agents and new direct ones have none. */
function storedConversation(
  opened: OpenedConversation | null,
): { readonly id: string; readonly isMuted: boolean } | null {
  if (!opened) return null;
  if (opened.kind === "group")
    return { id: opened.group.id, isMuted: opened.group.isMuted === true };
  const { conversationId, isMuted } = opened.participant;
  return conversationId
    ? { id: conversationId, isMuted: isMuted === true }
    : null;
}

/** Mutes the opened stored conversation; the requested state shows at once. */
function useMute(
  conversation: {
    readonly id: string;
    readonly isMuted: boolean;
  } | null,
): { readonly isMuted: boolean | null; toggle(): void } {
  const muter = useFetcher();
  const requested = muter.formData;
  const isRequested =
    conversation !== null &&
    requested?.get("conversationId") === conversation.id;
  const isMuted = isRequested
    ? requested.get("isMuted") === "true"
    : (conversation?.isMuted ?? null);

  function toggle(): void {
    if (conversation === null || isMuted === null) return;
    const formData = new FormData();
    formData.set("intent", "mute");
    formData.set("conversationId", conversation.id);
    formData.set("isMuted", String(!isMuted));
    void muter.submit(formData, { method: "post" });
  }

  return { isMuted, toggle };
}

/** The message on its way, shown until the history holds it. */
function pendingMessage(
  formData: FormData | undefined,
  selection: VirtualChatSelection | null,
): VirtualChatMessage | null {
  const text = formData?.get("text");
  const targetId =
    formData?.get("agentId") ??
    formData?.get("participantId") ??
    formData?.get("groupId");
  if (typeof text !== "string" || targetId !== selection?.id) return null;
  const clientMessageId = formData?.get("clientMessageId");
  const baseMessage: VirtualChatMessage = {
    id: "pending",
    authorId: null,
    content: text,
    toolUses: [],
    ...(typeof clientMessageId === "string" &&
    clientMessageId.startsWith(CONVERSATION_PREVIEW_SEND_PREFIX)
      ? { isFromPreview: true }
      : {}),
  };
  return withPendingDelivery(baseMessage, formData);
}

/** Attaches how a message sent mid-answer goes to the agents (PAGE-381). */
function withPendingDelivery(
  message: VirtualChatMessage,
  formData: FormData | undefined,
): VirtualChatMessage {
  const delivery = formData?.get("delivery");
  if (delivery === "after") return { ...message, queue: "chat" };
  const steered = formData?.get("steeredInto");
  const agentIds = typeof steered === "string" ? steered.split(",") : [];
  if (delivery === "steer" && agentIds.length > 0)
    return { ...message, steeredInto: agentIds };
  return message;
}

/** The form of a message to the opened conversation, or `null` when nothing can be sent. */
function messageForm(
  opened: OpenedConversation,
  content: string,
  attachmentIds: readonly string[],
  clientMessageId: string = crypto.randomUUID(),
): FormData | null {
  const formData = new FormData();
  formData.set("text", content);
  if (attachmentIds.length > 0)
    formData.set("attachmentIds", JSON.stringify(attachmentIds));
  formData.set("clientMessageId", clientMessageId);
  if (opened.kind === "group") {
    formData.set("intent", "send-group");
    formData.set("groupId", opened.group.id);
    return formData;
  }
  const { participant } = opened;
  if (!participant.canChat) return null;
  const isAgent = participant.kind === "agent";
  formData.set("intent", isAgent ? "send" : "send-direct");
  formData.set(isAgent ? "agentId" : "participantId", participant.id);
  return formData;
}

/**
 * Whether somebody answers in the opened conversation and who: the opened
 * agent, or the agents of the opened group (PAGE-276).
 */
function answeringState(
  opened: OpenedConversation | null,
  hasPending: boolean,
): {
  readonly isAnswering: boolean;
  readonly answeringNames: readonly string[];
} {
  if (opened?.kind === "group") {
    const names = opened.group.workingAgentNames ?? [];
    return { isAnswering: names.length > 0, answeringNames: names };
  }
  const participant = opened?.participant;
  return {
    isAnswering:
      participant?.kind === "agent" &&
      (hasPending || participant.status === "working"),
    answeringNames: participant ? [participant.name] : [],
  };
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

function createSendActions(context: {
  readonly opened: OpenedConversation | null;
  readonly selection: VirtualChatSelection | null;
  readonly isAnswering: boolean;
  readonly workingAgentIds: readonly string[];
  readonly touch: (selection: VirtualChatSelection) => void;
  readonly submit: ReturnType<typeof useFetcher>["submit"];
  readonly controls: ReturnType<typeof useAgentControls>;
}): Pick<ChatPageState, "send" | "sendFromPreview" | "stopAll"> {
  const {
    opened,
    selection,
    isAnswering,
    workingAgentIds,
    touch,
    submit,
    controls,
  } = context;
  function send(
    content: string,
    attachmentIds: readonly string[] = [],
    delivery?: ConversationDelivery,
  ): void {
    const isEmpty = content.trim() === "" && attachmentIds.length === 0;
    if (isEmpty || !opened || !selection) return;
    const formData = messageForm(opened, content, attachmentIds);
    if (!formData) return;
    if (isAnswering && delivery) {
      formData.set("delivery", delivery);
      formData.set("steeredInto", workingAgentIds.join(","));
    }
    touch(selection);
    void submit(formData, { method: "post" });
  }
  function sendFromPreview(text: string): void {
    if (text.trim() === "" || !opened || !selection) return;
    const formData = messageForm(
      opened,
      text,
      [],
      `${CONVERSATION_PREVIEW_SEND_PREFIX}${crypto.randomUUID()}`,
    );
    if (!formData) return;
    touch(selection);
    void submit(formData, { method: "post" });
  }
  function stopAll(): void {
    if (opened?.kind !== "group") {
      controls.stop();
      return;
    }
    for (const agentId of workingAgentIds) controls.stopGroupAgent(agentId);
  }
  return { send, sendFromPreview, stopAll };
}

/**
 * Selection, search and the conversation with agents and groups on the chat
 * page.
 *
 * @remarks
 * Both lists come newest activity first; the first group opens at first,
 * else the first agent of the list. A sent message goes over the page's
 * action and shows at once: to an agent, which answers over ACP, or into the
 * stored conversation with a person or of a group (PAGE-278), whose other
 * members see it live. Answers arrive over `conversations.v1` while they are
 * written (PAGE-381); the page reads its data again when an answer ended,
 * never at fixed intervals. Opening a conversation with unread messages
 * marks it read.
 */
export function useChatPage(
  directory: VirtualChatDirectory,
  requestedSelection?: VirtualChatSelection,
): ChatPageState {
  const [query, setQuery] = useState("");
  const activity = useChatActivity(directory);
  const lists: ChatLists = activity;
  const [selection, setSelection] = useState(
    () => requestedSelection ?? firstSelection(lists),
  );
  const sender = useFetcher();
  const stream = useConversationStream();

  const found = searchLists(lists, query);
  const opened = openConversation(lists, selection);
  const controls = useAgentControls(opened);
  const historyId = selection?.id ?? "";
  const pending = pendingMessage(sender.formData, selection);
  const stored = directory.histories[historyId] ?? [];
  const conversation = storedConversation(opened);
  const older = useOlderHistory(
    conversation?.id ?? null,
    stored,
    directory.olderHistoryIds?.includes(historyId) === true,
  );
  const mute = useMute(conversation);
  const messages = pending ? [...older.messages, pending] : older.messages;
  const answering = answeringState(opened, pending !== null);
  const liveChat = useLiveChat({
    opened,
    state: stream.state,
    messages,
    findParticipant: (id) =>
      lists.participants.find((participant) => participant.id === id),
    onCancelTool: controls.cancelAgentTool,
  });
  const isAnswering = answering.isAnswering || liveChat.isWriting;
  useConversationRead(opened, stored);
  const actions = createSendActions({
    opened,
    selection,
    isAnswering,
    workingAgentIds: liveChat.workingAgentIds,
    touch: activity.touch,
    submit: sender.submit,
    controls,
  });

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
    hasOlder: older.hasMore,
    isLoadingOlder: older.isLoading,
    loadOlder: older.loadOlder,
    isMuted: mute.isMuted,
    toggleMute: mute.toggle,
    isAnswering,
    answeringNames: answering.answeringNames,
    voiceMaximumMs:
      directory.voiceMaximumMs ??
      CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS * 1000,
    sendFailure: readSendFailure(sender),
    ...actions,
    live: liveChat.history,
    activity: liveChat.activity,
    isLive: stream.isConnected,
    addMember: activity.addMember,
    stop: controls.stop,
    stopGroupAgent: controls.stopGroupAgent,
    liveTools: isAnswering ? (directory.liveToolUses?.[historyId] ?? []) : [],
    cancelTool: controls.cancelTool,
    resumeAgents: controls.resumeAgents,
    findParticipant: (id) =>
      lists.participants.find((participant) => participant.id === id),
    findMembers: (group) => membersOf(group, lists.participants),
  };
}
