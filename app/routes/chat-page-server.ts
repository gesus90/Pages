import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { shareChatGroup } from "@/app/lib/chat-page-conversations.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { ConversationErrorCode } from "@/definition/Conversation";
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
  | "stop-group"
  | "cancel-tool"
  | "create-group"
  | "add-member"
  | "send-group"
  | "send-direct"
  | "read"
  | "mute"
  | "history"
  | "confidential";

/** What a change yields besides success: a created group or a page of older messages. */
interface ChatIntentOutcome {
  readonly groupId?: string;
  readonly history?: VirtualChatHistoryPage;
}

const INTENTS: readonly ChatPageIntent[] = [
  "save-contacts",
  "send",
  "stop",
  "stop-group",
  "cancel-tool",
  "create-group",
  "add-member",
  "send-group",
  "send-direct",
  "read",
  "mute",
  "history",
  "confidential",
];

/** How a refused conversation request reads on the page (PAGE-278). */
const CONVERSATION_FAILURES: Readonly<
  Record<ConversationErrorCode, VirtualChatSendFailure>
> = {
  forbidden: "inactive",
  not_found: "invalidInput",
  invalid: "invalidInput",
  too_large: "invalidInput",
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
  });
  if (isOwn)
    await services.chatGroupService.recordActivity(person, {
      kind: "group",
      id: groupId,
    });
}

/**
 * Mutes a stored conversation for the person alone, or reads a page of its
 * older messages (PAGE-275); both answer `not_found` to a non-member. Marks
 * a chat with agents confidential (PAGE-305).
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

/** The changes of one member of a chat that leave everybody else's view alone. */
const MEMBER_INTENTS = ["mute", "history", "confidential"] as const;

function isMemberIntent(
  intent: ChatPageIntent,
): intent is (typeof MEMBER_INTENTS)[number] {
  return MEMBER_INTENTS.some((candidate) => candidate === intent);
}

/** Marks a chat with agents confidential or not; nothing of it is shared or learned (PAGE-305). */
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

/** Runs one change of the person; returns a created group or a history page. */
async function runIntent(
  services: ChatServices,
  person: User,
  intent: ChatPageIntent,
  formData: FormData,
): Promise<ChatIntentOutcome> {
  if (isMemberIntent(intent))
    return runMemberIntent(services, person, intent, formData);
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
    case "stop-group":
      // Only the answer of this agent in this conversation stops (PAGE-304).
      await services.conversationAgentReplies.stop(
        person,
        String(formData.get("groupId") ?? ""),
        String(formData.get("agentId") ?? ""),
      );
      return {};
    case "cancel-tool":
      await services.agentEmployeeSessions.cancelTool(
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
  return {
    ...directory,
    voiceMaximumMs: services.conversationVoiceMaximumMs,
  };
}

/**
 * Saves the participant list, creates a group or adds a member, stores a
 * message to a group or a person or a read state (PAGE-278), mutes a
 * conversation or reads its older messages (PAGE-275), sends a message to
 * an agent or stops its answer, stops the answer of one agent in a group
 * (PAGE-304), or marks a chat with agents confidential (PAGE-305).
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
