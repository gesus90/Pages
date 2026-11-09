import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ConversationErrorCode } from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  VirtualChatDirectory,
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
  | "read";

const INTENTS: readonly ChatPageIntent[] = [
  "save-contacts",
  "send",
  "stop",
  "create-group",
  "add-member",
  "send-group",
  "send-direct",
  "read",
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
  costLimitReached: "costLimitReached",
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

type ChatServices = Awaited<ReturnType<typeof getApplicationServices>>;

/**
 * Makes a group of the person a conversation its members share and adds the
 * members it gained, so they see the group and its history (PAGE-278).
 */
async function shareGroup(
  services: ChatServices,
  person: User,
  groupId: FormDataEntryValue | null,
): Promise<boolean> {
  const group = await services.chatGroupService.find(person, groupId);
  if (!group) return false;
  await services.conversationService.adoptGroup(person, group);
  return true;
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
  const isOwn = await shareGroup(services, person, groupId);
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

/** Runs one change of the person; returns the ID of a created group. */
async function runIntent(
  services: ChatServices,
  person: User,
  intent: ChatPageIntent,
  formData: FormData,
): Promise<string | undefined> {
  switch (intent) {
    case "save-contacts":
      await services.chatDirectoryService.saveContacts(
        person,
        readJson(formData.get("contacts")),
      );
      return undefined;
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
      return undefined;
    case "stop":
      await services.agentEmployeeSessions.stop(
        person,
        formData.get("agentId"),
      );
      return undefined;
    case "create-group": {
      const groupId = await services.chatGroupService.create(person, {
        name: formData.get("name"),
        description: formData.get("description"),
        memberIds: readJson(formData.get("memberIds")),
      });
      await shareGroup(services, person, groupId);
      return groupId;
    }
    case "add-member":
      await services.chatGroupService.addMember(
        person,
        formData.get("groupId"),
        formData.get("participantId"),
      );
      await shareGroup(services, person, formData.get("groupId"));
      return undefined;
    case "send-group":
    case "send-direct":
    case "read":
      await runConversationIntent(services, person, intent, formData);
      return undefined;
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
  return services.chatDirectoryService.directory(person);
}

/**
 * Saves the participant list, creates a group or adds a member, stores a
 * message to a group or a person or a read state (PAGE-278), sends a
 * message to an agent or stops its answer.
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
    const groupId = await runIntent(services, person, intent, formData);
    return data<ChatPageActionData>({ ok: true, intent, groupId });
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
