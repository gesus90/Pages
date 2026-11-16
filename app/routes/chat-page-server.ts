import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_TASK_INTENTS,
  CHAT_TASK_STATUS,
  chatTaskFailure,
  isChatTaskIntent,
  runChatTaskIntent,
} from "@/app/lib/chat-page-tasks.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

import { runChatPageIntent } from "./chat-page-intents.server";

import type { AgentChatCommandOutcome } from "@/definition/AgentChatControl";
import type { ChatTaskIntent } from "@/app/lib/chat-page-tasks.server";
import type {
  AgentChatTaskErrorCode,
  AgentChatTaskView,
} from "@/definition/AgentChatTask";
import type { ConversationErrorCode } from "@/definition/Conversation";
import type {
  ConversationDecisionEntry,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { ConversationGroupContextView } from "@/definition/ConversationObserver";
import type {
  VirtualChatDirectory,
  VirtualChatHistoryPage,
  VirtualChatSendFailure,
} from "@/definition/VirtualChat";
import type { Route } from "./+types/chat-page-server";

/** What a change on the chat page answers. */
export type ChatPageActionData =
  | {
      readonly ok: true;
      readonly intent: ChatPageIntent;
      /** The ID of a group just created. */
      readonly groupId?: string;
      /** A page of older messages, the answer of `history`. */
      readonly history?: VirtualChatHistoryPage;
      /** The stored context of a group, the answer of `group-context`. */
      readonly groupContext?: ConversationGroupContextView;
      /** The settings "Wer antwortet?" of a group, the answer of `reply-settings` and `save-reply-settings`. */
      readonly replySettings?: ConversationReplySettingsView;
      /** The last decisions of a group, the answer of `reply-decisions`. */
      readonly replyDecisions?: readonly ConversationDecisionEntry[];
      /** What a chat command answered instead of a sent message. */
      readonly commandOutcome?: AgentChatCommandOutcome;
      /** The scheduled tasks of a chat, the answer of the dialog "Geplante Aufgaben". */
      readonly chatTasks?: readonly AgentChatTaskView[];
    }
  | {
      readonly ok: false;
      readonly intent: ChatPageIntent;
      readonly error: VirtualChatSendFailure;
      /** Why a change of a scheduled task was refused. */
      readonly taskError?: AgentChatTaskErrorCode;
    };

/** The changes the chat page sends. */
export type ChatPageIntent =
  | "save-contacts"
  | "send"
  | "stop"
  | "stop-group"
  | "cancel-tool"
  | "cancel-group-tool"
  | "create-group"
  | "add-member"
  | "send-group"
  | "send-direct"
  | "read"
  | "mute"
  | "history"
  | "group-context"
  | "reply-settings"
  | "save-reply-settings"
  | "reply-decisions"
  | "confidential"
  | "resume-agents"
  | "delete-message"
  | "embed-domain"
  | "card-state"
  | "split-width"
  | "list-collapsed"
  | "answer-question"
  | ChatTaskIntent;

const INTENTS: readonly ChatPageIntent[] = [
  ...CHAT_TASK_INTENTS,
  "save-contacts",
  "send",
  "stop",
  "stop-group",
  "cancel-tool",
  "cancel-group-tool",
  "create-group",
  "add-member",
  "send-group",
  "send-direct",
  "read",
  "mute",
  "history",
  "group-context",
  "reply-settings",
  "save-reply-settings",
  "reply-decisions",
  "confidential",
  "resume-agents",
  "delete-message",
  "embed-domain",
  "card-state",
  "split-width",
  "list-collapsed",
  "answer-question",
];

/** How a refused conversation request reads on the page. */
const CONVERSATION_FAILURES: Readonly<
  Record<ConversationErrorCode, VirtualChatSendFailure>
> = {
  forbidden: "inactive",
  not_found: "invalidInput",
  invalid: "invalidInput",
  too_large: "tooLarge",
  too_long: "tooLong",
  unsupported_format: "invalidInput",
};

const CONVERSATION_STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

const FAILURES: Readonly<Record<string, VirtualChatSendFailure>> = {
  inactive: "inactive",
  busy: "busy",
  unavailable: "unavailable",
  accessUnsupported: "unavailable",
  modelNotAllowed: "unavailable",
};

const FAILURE_STATUS: Readonly<Record<string, number>> = {
  busy: 409,
  notFound: 404,
};

function readIntent(value: FormDataEntryValue | null): ChatPageIntent | null {
  return INTENTS.find((intent) => intent === value) ?? null;
}

/**
 * Loads the chat page of the signed-in person: their own
 * participants and groups, the choices of the participant dialog and the histories
 * with agents; the workspace frame applies the authentication.
 */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<VirtualChatDirectory> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  const directory = await services.chatDirectoryService.directory(person);
  const conversationIds = [
    ...directory.groups.map((group) => group.id),
    ...directory.participants.flatMap((participant) =>
      participant.conversationId ? [participant.conversationId] : [],
    ),
  ];
  const [embedDomains, viewPreferences, accounts, chatDecisionStatus, groups] =
    await Promise.all([
      services.conversationLinks.embedDomains(conversationIds),
      services.chatViewPreferences.read(person),
      services.conversationDirectory.read(),
      services.chatDecisionSettingsService.currentStatus(),
      Promise.all(
        directory.groups.map(async (group) => {
          if (group.isAgentConversation) return group;
          try {
            const settings =
              await services.conversationReplySettingsService.read(
                person,
                group.id,
              );
            return { ...group, replyMode: settings.mode };
          } catch (error: unknown) {
            // A personal group is adopted into a shared conversation on its first use.
            if (
              error instanceof ConversationError &&
              error.code === "not_found"
            )
              return { ...group, replyMode: CONVERSATION_DEFAULT_REPLY_MODE };
            throw error;
          }
        }),
      ),
    ]);
  return {
    ...directory,
    groups,
    mentionDirectory: accounts.mentionsFor(person.id),
    chatDecisionStatus,
    voiceMaximumMs: services.conversationVoiceMaximumMs,
    embedDomains,
    viewPreferences,
  };
}

/**
 * Saves the participant list, creates a group or adds a member, stores a
 * message to a group or a person or a read state, mutes a
 * conversation or reads its older messages, sends a message to
 * an agent or stops its answer, stops the answer of one agent in a group,
 * or marks a chat with agents confidential.
 * @remarks
 * Saving the list only adds and removes entries of the person's own list;
 * it never creates or deletes an account or agent. Every change is bound to
 * the signed-in person's own participants and groups.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<ReturnType<typeof data<ChatPageActionData>>> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const intent = readIntent(formData.get("intent"));
  if (!intent) throw new Response("Bad Request", { status: 400 });
  const services = await getApplicationServices();
  try {
    if (isChatTaskIntent(intent)) {
      const outcome = await runChatTaskIntent(
        services.agentChatTaskService,
        person,
        intent,
        formData,
      );
      return data<ChatPageActionData>({ ok: true, intent, ...outcome });
    }
    const outcome = await runChatPageIntent(services, person, intent, formData);
    return data<ChatPageActionData>({ ok: true, intent, ...outcome });
  } catch (error: unknown) {
    const taskError = chatTaskFailure(error);
    if (taskError !== null)
      return data<ChatPageActionData>(
        { ok: false, intent, error: "invalidInput", taskError },
        { status: CHAT_TASK_STATUS[taskError] },
      );
    if (error instanceof ConversationError) {
      logCaughtError("chat_page", error);
      return data<ChatPageActionData>(
        { ok: false, intent, error: CONVERSATION_FAILURES[error.code] },
        { status: CONVERSATION_STATUS[error.code] },
      );
    }
    if (!(error instanceof AgentEmployeeError)) throw error;
    logCaughtError("chat_page", error);
    return data<ChatPageActionData>(
      { ok: false, intent, error: FAILURES[error.code] ?? "invalidInput" },
      { status: FAILURE_STATUS[error.code] ?? 400 },
    );
  }
}
