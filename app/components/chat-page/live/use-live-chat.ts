import { useTranslation } from "react-i18next";

import {
  activityOf,
  answersOfChat,
  endedByMessage,
  shownLiveAnswers,
} from "./live-answer-state";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type {
  VirtualChatMessage,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { HistoryLive } from "../chat-page-history";
import type { OpenedConversation } from "../use-chat-page";
import type { AgentActivity } from "./chat-page-activity-row";
import type {
  LiveAnswerState,
  LiveAnswerView,
  LiveChat,
} from "./live-answer-state";

/** What the opened chat shows of the answers being written. */
export interface LiveChatView {
  readonly history: HistoryLive;
  readonly activity: readonly AgentActivity[];
  /** Whether an agent of the chat is writing an answer now. */
  readonly isWriting: boolean;
  /** The agents at work in the chat now, whose answers a message can steer. */
  readonly workingAgentIds: readonly string[];
}

interface LiveChatInput {
  readonly opened: OpenedConversation | null;
  readonly state: LiveAnswerState;
  readonly messages: readonly VirtualChatMessage[];
  readonly findParticipant: (id: string) => VirtualParticipant | undefined;
  readonly onCancelTool: (agentId: string) => void;
}

/**
 * The chat the live answers of the opened entry are written in: the group,
 * the direct chat with an agent, or the stored conversation with a person.
 *
 * @param opened - The opened entry.
 * @returns `null` when nothing is opened or no answer can be written there.
 */
export function liveChatOf(opened: OpenedConversation | null): LiveChat | null {
  if (!opened) return null;
  if (opened.kind === "group")
    return { chatKind: "conversation", chatId: opened.group.id };
  const { participant } = opened;
  if (participant.kind === "agent")
    return { chatKind: "agent", chatId: participant.id };
  return participant.conversationId
    ? { chatKind: "conversation", chatId: participant.conversationId }
    : null;
}

/** The agents the loaded page names as working, before any part arrived. */
function loadedWorkers(
  opened: OpenedConversation | null,
): readonly { readonly id: string; readonly name: string }[] {
  if (!opened) return [];
  if (opened.kind === "group") return opened.group.workingAgents ?? [];
  const { participant } = opened;
  return participant.kind === "agent" && participant.status === "working"
    ? [{ id: participant.id, name: participant.name }]
    : [];
}

function modelLabelOf(
  opened: OpenedConversation | null,
  agentId: string,
): AgentChatModelLabel | undefined {
  if (!opened) return undefined;
  if (opened.kind === "group") return opened.group.agentModels?.[agentId];
  return opened.participant.id === agentId
    ? opened.participant.chatModel
    : undefined;
}

/** The newest running answer of each agent. */
function runningByAgent(
  views: readonly LiveAnswerView[],
): ReadonlyMap<string, LiveAnswerView> {
  const result = new Map<string, LiveAnswerView>();
  for (const view of views) if (view.end === null) result.set(view.agentId, view);
  return result;
}

/**
 * The answers being written in the opened chat (PAGE-381): those the history
 * shows, the ended ones whose stored message carries their thoughts and tool
 * times, how messages reached the agents, and who works on what.
 */
export function useLiveChat({
  opened,
  state,
  messages,
  findParticipant,
  onCancelTool,
}: LiveChatInput): LiveChatView {
  const { t } = useTranslation();
  const views = answersOfChat(state, liveChatOf(opened));
  const storedIds = new Set(messages.map((message) => message.id));
  const running = runningByAgent(views);
  const loaded = loadedWorkers(opened);
  const workingAgentIds = [
    ...new Set([...running.keys(), ...loaded.map((agent) => agent.id)]),
  ];

  function nameOf(agentId: string): string {
    return (
      findParticipant(agentId)?.name ??
      (opened?.kind === "group"
        ? opened.members.find((member) => member.id === agentId)?.name
        : undefined) ??
      loaded.find((agent) => agent.id === agentId)?.name ??
      agentId
    );
  }

  function modelOf(agentId: string): string | undefined {
    const model = modelLabelOf(opened, agentId);
    if (!model) return undefined;
    const effort = model.reasoningEffort;
    return effort
      ? `${model.name} · ${t(`chatPage.modelChoice.effort.${effort}`, { defaultValue: effort })}`
      : model.name;
  }

  const activity: AgentActivity[] = workingAgentIds.flatMap((agentId) => {
    const current = activityOf(running.get(agentId) ?? null);
    if (current === null) return [];
    const participant = findParticipant(agentId);
    return [
      {
        agent: {
          id: agentId,
          name: nameOf(agentId),
          color: participant?.color ?? null,
          avatarImageUrl: participant?.avatarImageUrl ?? null,
        },
        activity: current,
      },
    ];
  });

  return {
    history: {
      answers: shownLiveAnswers(views, storedIds),
      ended: endedByMessage(views),
      deliveries: state.deliveries,
      nameOf,
      modelOf,
      onCancelTool,
    },
    activity,
    isWriting: running.size > 0,
    workingAgentIds,
  };
}
