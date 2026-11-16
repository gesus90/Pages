import {
  isChatTaskIntent,
  runChatTaskIntent,
} from "@/app/lib/chat-page-tasks.server";
import type { AgentChatTaskView } from "@/definition/AgentChatTask";
import { shareChatGroup } from "@/app/lib/chat-page-conversations.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { parseAgentChatCommand } from "@/definition/AgentChatControl";
import { CONVERSATION_PREVIEW_SEND_PREFIX } from "@/definition/Conversation";
import { ConversationError } from "@/backend/error/ConversationError";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { AgentChatCommandOutcome } from "@/definition/AgentChatControl";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type {
  ConversationDecisionEntry,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { ConversationGroupContextView } from "@/definition/ConversationObserver";
import type { User } from "@/definition/User";
import type { VirtualChatHistoryPage } from "@/definition/VirtualChat";
import type { ChatTaskIntent } from "@/app/lib/chat-page-tasks.server";
import type { ChatPageIntent } from "./chat-page-server";

/** What a change yields besides success: a created group, a page of older messages or a group context. */
export interface ChatIntentOutcome {
  readonly groupId?: string;
  readonly history?: VirtualChatHistoryPage;
  readonly groupContext?: ConversationGroupContextView;
  readonly replySettings?: ConversationReplySettingsView;
  readonly replyDecisions?: readonly ConversationDecisionEntry[];
  readonly commandOutcome?: AgentChatCommandOutcome;
  readonly chatTasks?: readonly AgentChatTaskView[];
}

type ChatServices = ChatPageServices;

function readJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** How the person sent a message while agents answered; absent as before. */
function readDelivery(
  value: FormDataEntryValue | null,
): ConversationDelivery | undefined {
  return value === "steer" || value === "after" ? value : undefined;
}

/** A message to an agent outside the person's own list changes no order. */
async function recordParticipantActivity(
  services: ChatServices,
  person: User,
  agentId: FormDataEntryValue | null,
): Promise<void> {
  if (typeof agentId !== "string") return;
  try {
    await services.chatGroupService.recordActivity(person, {
      kind: "participant",
      id: agentId,
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentEmployeeError) || error.code !== "notFound")
      throw error;
  }
}

/** Stores a message of a group or of a direct conversation with a person, or a read state. */
async function runConversationIntent(
  services: ChatServices,
  person: User,
  intent: "send-group" | "send-direct" | "read",
  formData: FormData,
): Promise<void> {
  const { conversationService } = services;
  const text = formData.get("text");
  const clientMessageId = formData.get("clientMessageId");
  const attachmentIds = readJson(formData.get("attachmentIds")) ?? undefined;
  if (intent === "read") {
    await conversationService.markRead(person, {
      conversationId: String(formData.get("conversationId") ?? ""),
      upToMessageId: String(formData.get("upToMessageId") ?? ""),
    });
    return;
  }
  if (intent === "send-direct") {
    const conversation = await conversationService.openDirect(
      person,
      String(formData.get("participantId") ?? ""),
    );
    await conversationService.send(person, {
      conversationId: conversation.id,
      clientMessageId,
      text,
      attachmentIds,
    });
    await recordParticipantActivity(
      services,
      person,
      formData.get("participantId"),
    );
    return;
  }
  const groupId = String(formData.get("groupId") ?? "");
  const isOwn = await shareChatGroup(services, person, groupId);
  const delivery = readDelivery(formData.get("delivery"));
  await conversationService.send(
    person,
    { conversationId: groupId, clientMessageId, text, attachmentIds },
    delivery === undefined ? {} : { delivery },
  );
  if (isOwn)
    await services.chatGroupService.recordActivity(person, {
      kind: "group",
      id: groupId,
    });
}

const MEMBER_INTENTS = ["mute", "history", "confidential"] as const;

function isMemberIntent(
  intent: ChatPageIntent,
): intent is (typeof MEMBER_INTENTS)[number] {
  return MEMBER_INTENTS.some((candidate) => candidate === intent);
}

/** Marks a chat with agents confidential or not; nothing of it is shared or learned. */
async function markConfidential(
  services: ChatServices,
  person: User,
  formData: FormData,
): Promise<void> {
  const fields = ["agentId", "conversationId", "isConfidential"].flatMap(
    (key) => {
      const entry = formData.get(key);
      return typeof entry === "string" ? [[key, entry] as const] : [];
    },
  );
  await services.agentChatPrivacyService.setConfidential(
    person,
    Object.fromEntries(fields),
  );
}

/**
 * Mutes a stored conversation for the person alone, or reads a page of its
 * older messages; both answer `not_found` to a non-member. Marks
 * a chat with agents confidential.
 */
async function runMemberIntent(
  services: ChatServices,
  person: User,
  intent: (typeof MEMBER_INTENTS)[number],
  formData: FormData,
): Promise<ChatIntentOutcome> {
  if (intent === "confidential") {
    await markConfidential(services, person, formData);
    return {};
  }
  if (intent === "history")
    return {
      history: await services.chatDirectoryService.olderMessages(person, {
        conversationId: formData.get("conversationId"),
        beforeId: formData.get("beforeId"),
      }),
    };
  const isMuted = formData.get("isMuted");
  if (isMuted !== "true" && isMuted !== "false")
    throw new ConversationError("invalid");
  await services.conversationService.setMuted(person, {
    conversationId: String(formData.get("conversationId") ?? ""),
    isMuted: isMuted === "true",
  });
  return {};
}

/** Reads or changes who answers in a group; only the one who manages the group changes it. */
async function runReplySettingsIntent(
  services: ChatServices,
  person: User,
  intent: "reply-settings" | "save-reply-settings" | "reply-decisions",
  formData: FormData,
): Promise<ChatIntentOutcome> {
  const { conversationReplySettingsService } = services;
  if (intent === "reply-settings")
    return {
      replySettings: await conversationReplySettingsService.read(
        person,
        formData.get("conversationId"),
      ),
    };
  if (intent === "reply-decisions")
    return {
      replyDecisions: await conversationReplySettingsService.decisions(
        person,
        formData.get("conversationId"),
      ),
    };
  return {
    replySettings: await conversationReplySettingsService.save(person, {
      conversationId: formData.get("conversationId"),
      mode: formData.get("mode"),
      // Without values of its own a group follows the defaults of the instance.
      rules:
        formData.get("useDefaults") === "true"
          ? null
          : {
              answerThreshold: Number(formData.get("answerThreshold")),
              responsibilityThreshold: Number(
                formData.get("responsibilityThreshold"),
              ),
              secondThreshold: Number(formData.get("secondThreshold")),
              maximumResponders: Number(formData.get("maximumResponders")),
            },
      ...(formData.has("automaticRepliesPerOrigin")
        ? {
            automaticRepliesPerOrigin: Number(
              formData.get("automaticRepliesPerOrigin"),
            ),
          }
        : {}),
    }),
  };
}

const CONTENT_INTENTS = [
  "delete-message",
  "embed-domain",
  "card-state",
  "split-width",
  "list-collapsed",
  "answer-question",
] as const;

type ContentIntent = (typeof CONTENT_INTENTS)[number];

function isContentIntent(intent: ChatPageIntent): intent is ContentIntent {
  return CONTENT_INTENTS.some((known) => known === intent);
}

/**
 * Deletes an own message, releases or withdraws an embed domain of a
 * conversation, or stores a card state or the split width or
 * the state of the list.
 */
async function runContentIntent(
  services: ChatServices,
  person: User,
  intent: ContentIntent,
  formData: FormData,
): Promise<void> {
  switch (intent) {
    case "delete-message":
      await services.conversationService.deleteMessage(
        person,
        formData.get("messageId"),
      );
      return;
    case "embed-domain":
      await services.conversationLinks.setReleased(person, {
        conversationId: formData.get("conversationId"),
        domain: formData.get("domain"),
        isReleased: formData.get("isReleased") === "true",
      });
      return;
    case "card-state":
      await services.chatViewPreferences.setCardState(person, {
        cardKey: formData.get("cardKey"),
        state: formData.get("state"),
      });
      return;
    case "split-width":
      await services.chatViewPreferences.setSplitWidth(
        person,
        formData.get("width"),
      );
      return;
    case "answer-question":
      await services.agentChatQuestions.answer(person, {
        questionId: formData.get("questionId"),
        answers: readJson(formData.get("answers")),
      });
      return;
    case "list-collapsed":
      await services.chatViewPreferences.setListCollapsed(
        person,
        formData.get("isCollapsed"),
      );
  }
}

const AGENT_CONTROL_INTENTS = [
  "stop",
  "stop-group",
  "cancel-tool",
  "cancel-group-tool",
  "resume-agents",
] as const;

type AgentControlIntent = (typeof AGENT_CONTROL_INTENTS)[number];

function isAgentControlIntent(
  intent: ChatPageIntent,
): intent is AgentControlIntent {
  return AGENT_CONTROL_INTENTS.some((candidate) => candidate === intent);
}

/** Stops the answer of an agent or one of its tool calls, or lets paused agents go on. */
async function runAgentControlIntent(
  services: ChatServices,
  person: User,
  intent: AgentControlIntent,
  formData: FormData,
): Promise<void> {
  switch (intent) {
    case "stop":
      await services.agentEmployeeSessions.stop(
        person,
        formData.get("agentId"),
      );
      return;
    case "stop-group":
      await services.conversationAgentReplies.stop(
        person,
        String(formData.get("groupId") ?? ""),
        String(formData.get("agentId") ?? ""),
      );
      return;
    case "cancel-tool":
      await services.agentEmployeeSessions.cancelTool(
        person,
        formData.get("agentId"),
      );
      return;
    case "cancel-group-tool":
      await services.conversationAgentReplies.cancelTool(
        person,
        String(formData.get("groupId") ?? ""),
        String(formData.get("agentId") ?? ""),
      );
      return;
    case "resume-agents":
      await services.conversationAgentGuard.resume(
        person,
        String(formData.get("conversationId") ?? ""),
      );
  }
}

/** Whether a message comes from a preview of the chat. */
function isPreviewMessage(formData: FormData): boolean {
  const clientMessageId = formData.get("clientMessageId");
  return (
    typeof clientMessageId === "string" &&
    clientMessageId.startsWith(CONVERSATION_PREVIEW_SEND_PREFIX)
  );
}

/**
 * A chat command typed into the direct chat with an agent or a group runs as
 * a command: it is never stored as a message, so it reaches no
 * agent and asks for no answer and no decision.
 * @returns The outcome of the command, or `null` for a message.
 */
async function runTypedCommand(
  services: ChatServices,
  person: User,
  intent: ChatPageIntent,
  formData: FormData,
): Promise<ChatIntentOutcome | null> {
  const typed = formData.get("text");
  if (intent !== "send" && intent !== "send-group") return null;
  if (typeof typed !== "string" || parseAgentChatCommand(typed) === null)
    return null;
  if (isPreviewMessage(formData)) return null;
  const chat =
    intent === "send"
      ? { kind: "direct" as const, agentId: String(formData.get("agentId")) }
      : {
          kind: "group" as const,
          conversationId: String(formData.get("groupId") ?? ""),
        };
  return {
    commandOutcome: await services.agentChatCommandService.run(
      person,
      chat,
      typed,
    ),
  };
}

/** Runs one change of the person; returns a created group or a history page. */
export async function runChatPageIntent(
  services: ChatServices,
  person: User,
  intent: ChatPageIntent,
  formData: FormData,
): Promise<ChatIntentOutcome> {
  const command = await runTypedCommand(services, person, intent, formData);
  if (command !== null) return command;
  if (isMemberIntent(intent))
    return runMemberIntent(services, person, intent, formData);
  if (isContentIntent(intent)) {
    await runContentIntent(services, person, intent, formData);
    return {};
  }
  if (isAgentControlIntent(intent)) {
    await runAgentControlIntent(services, person, intent, formData);
    return {};
  }
  if (isChatTaskIntent(intent))
    return runChatTaskIntent(
      services.agentChatTaskService,
      person,
      intent,
      formData,
    );
  return runChatDispatchIntent(services, person, intent, formData);
}

async function runChatDispatchIntent(
  services: ChatServices,
  person: User,
  intent: Exclude<
    ChatPageIntent,
    | (typeof MEMBER_INTENTS)[number]
    | ContentIntent
    | AgentControlIntent
    | ChatTaskIntent
  >,
  formData: FormData,
): Promise<ChatIntentOutcome> {
  switch (intent) {
    case "save-contacts":
      await services.chatDirectoryService.saveContacts(
        person,
        readJson(formData.get("contacts")),
      );
      return {};
    case "send":
      await services.agentEmployeeSessions.send(person, {
        agentId: formData.get("agentId"),
        text: formData.get("text"),
        // The files were uploaded to the person's chat session with the agent.
        attachmentIds: readJson(formData.get("attachmentIds")) ?? undefined,
        clientMessageId: formData.get("clientMessageId"),
        delivery: readDelivery(formData.get("delivery")),
      });
      await recordParticipantActivity(
        services,
        person,
        formData.get("agentId"),
      );
      return {};
    case "create-group": {
      const groupId = await services.chatGroupService.create(person, {
        name: formData.get("name"),
        description: formData.get("description"),
        memberIds: readJson(formData.get("memberIds")),
      });
      await shareChatGroup(services, person, groupId);
      return { groupId };
    }
    case "add-member":
      await services.chatGroupService.addMember(
        person,
        formData.get("groupId"),
        formData.get("participantId"),
      );
      await shareChatGroup(services, person, formData.get("groupId"));
      return {};
    case "send-group":
    case "send-direct":
    case "read":
      await runConversationIntent(services, person, intent, formData);
      return {};
    case "group-context":
      return {
        groupContext: await services.conversationContextReader.forMember(
          person,
          formData.get("conversationId"),
        ),
      };
    case "reply-settings":
    case "save-reply-settings":
    case "reply-decisions":
      return runReplySettingsIntent(services, person, intent, formData);
  }
}
