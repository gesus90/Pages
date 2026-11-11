import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { shareChatGroup } from "@/app/lib/chat-page-conversations.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { ConversationErrorCode } from "@/definition/Conversation";
import type { ConversationGroupContextView } from "@/definition/ConversationObserver";
import type { User } from "@/definition/User";
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
      /** A page of older messages, the answer of `history` (PAGE-275). */
      readonly history?: VirtualChatHistoryPage;
      /** The stored context of a group, the answer of `group-context` (PAGE-296). */
      readonly groupContext?: ConversationGroupContextView;
    }
  | {
      readonly ok: false;
      readonly intent: ChatPageIntent;
      readonly error: VirtualChatSendFailure;
    };

/** The changes the chat page sends. */
export type ChatPageIntent =
  | "save-contacts"
  | "send"
  | "stop"
  | "create-group"
  | "add-member"
  | "send-group"
  | "send-direct"
  | "read"
  | "mute"
  | "history"
  | "group-context"
  | "delete-message"
  | "embed-domain"
  | "card-state"
  | "split-width";

/** What a change yields besides success: a created group, a page of older messages or a group context. */
interface ChatIntentOutcome {
  readonly groupId?: string;
  readonly history?: VirtualChatHistoryPage;
  readonly groupContext?: ConversationGroupContextView;
}

const INTENTS: readonly ChatPageIntent[] = [
  "save-contacts",
  "send",
  "stop",
  "create-group",
  "add-member",
  "send-group",
  "send-direct",
  "read",
  "mute",
  "history",
  "group-context",
  "delete-message",
  "embed-domain",
  "card-state",
  "split-width",
];

/** How a refused conversation request reads on the page (PAGE-278). */
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

function readJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

type ChatServices = ChatPageServices;

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
  await conversationService.send(person, {
    conversationId: groupId,
    clientMessageId,
    text,
    attachmentIds,
  });
  if (isOwn)
    await services.chatGroupService.recordActivity(person, {
      kind: "group",
      id: groupId,
    });
}

/**
 * Mutes a stored conversation for the person alone, or reads a page of its
 * older messages (PAGE-275); both answer `not_found` to a non-member.
 */
async function runMemberIntent(
  services: ChatServices,
  person: User,
  intent: "mute" | "history",
  formData: FormData,
): Promise<ChatIntentOutcome> {
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

/** The changes of the content of messages and of its cards (PAGE-298). */
type ContentIntent =
  "delete-message" | "embed-domain" | "card-state" | "split-width";

const CONTENT_INTENTS: readonly ContentIntent[] = [
  "delete-message",
  "embed-domain",
  "card-state",
  "split-width",
];

function isContentIntent(intent: ChatPageIntent): intent is ContentIntent {
  return CONTENT_INTENTS.some((known) => known === intent);
}

/**
 * Deletes an own message, releases or withdraws an embed domain of a
 * conversation, or stores a card state or the split width (PAGE-298).
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
  }
}

/** Runs one change of the person; returns a created group or a history page. */
async function runIntent(
  services: ChatServices,
  person: User,
  intent: ChatPageIntent,
  formData: FormData,
): Promise<ChatIntentOutcome> {
  if (isContentIntent(intent)) {
    await runContentIntent(services, person, intent, formData);
    return {};
  }
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
        clientMessageId: formData.get("clientMessageId"),
      });
      await recordParticipantActivity(
        services,
        person,
        formData.get("agentId"),
      );
      return {};
    case "stop":
      await services.agentEmployeeSessions.stop(
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
    case "mute":
    case "history":
      return runMemberIntent(services, person, intent, formData);
    case "group-context":
      return {
        groupContext: await services.conversationContextReader.forMember(
          person,
          formData.get("conversationId"),
        ),
      };
  }
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

/**
 * Loads the chat page of the signed-in person (PAGE-266, PAGE-259): their own
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
  const [embedDomains, viewPreferences] = await Promise.all([
    services.conversationLinks.embedDomains(conversationIds),
    services.chatViewPreferences.read(person),
  ]);
  return {
    ...directory,
    voiceMaximumMs: services.conversationVoiceMaximumMs,
    embedDomains,
    viewPreferences,
  };
}

/**
 * Saves the participant list, creates a group or adds a member, stores a
 * message to a group or a person or a read state (PAGE-278), mutes a
 * conversation or reads its older messages (PAGE-275), sends a message to
 * an agent or stops its answer.
 *
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
    const outcome = await runIntent(services, person, intent, formData);
    return data<ChatPageActionData>({ ok: true, intent, ...outcome });
  } catch (error: unknown) {
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
