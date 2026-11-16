import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { readAgentChatTarget } from "@/backend/service/employee/AgentChatAccess";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { AgentChatCommandChat } from "@/backend/service/employee/AgentChatCommandService";
import type {
  AgentChatControlFailure,
  AgentChatControlResponse,
} from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-control";

const FAILURES: Readonly<
  Partial<Record<string, { code: AgentChatControlFailure; status: number }>>
> = {
  forbidden: { code: "forbidden", status: 403 },
  notFound: { code: "notFound", status: 404 },
  invalidInput: { code: "invalidInput", status: 400 },
  modelNotAllowed: { code: "modelNotAllowed", status: 400 },
  unavailable: { code: "unavailable", status: 503 },
};

const CONVERSATION_FAILURES: Readonly<
  Record<string, { code: AgentChatControlFailure; status: number }>
> = {
  forbidden: { code: "forbidden", status: 403 },
  not_found: { code: "notFound", status: 404 },
};

type SuccessBody = Extract<AgentChatControlResponse, { readonly ok: true }>;

type IntentHandler = (
  services: ChatPageServices,
  person: User,
  formData: FormData,
) => Promise<SuccessBody>;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readJson(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(text(formData, key));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function targetOf(formData: FormData): ReturnType<typeof readAgentChatTarget> {
  return readAgentChatTarget({
    kind: formData.get("kind"),
    agentId: formData.get("agentId"),
    conversationId: formData.get("conversationId"),
  });
}

/** The chat a command was typed in: the direct chat with an agent or a group. */
function commandChat(formData: FormData): AgentChatCommandChat {
  if (formData.get("kind") === "group")
    return {
      kind: "group",
      conversationId: text(formData, "conversationId"),
    };
  return { kind: "direct", agentId: text(formData, "agentId") };
}

function settingOf(formData: FormData): unknown {
  const effort = text(formData, "reasoningEffort");
  return {
    connectionId: text(formData, "connectionId"),
    model: text(formData, "model"),
    reasoningEffort: effort === "" ? null : effort,
  };
}

const HANDLERS: Readonly<Record<string, IntentHandler>> = {
  models: async (services, person, formData) => ({
    ok: true,
    overview: await services.agentChatControlService.overview(
      person,
      targetOf(formData),
    ),
  }),
  "set-model": async (services, person, formData) => ({
    ok: true,
    overview: await services.agentChatControlService.setModel(
      person,
      targetOf(formData),
      settingOf(formData),
    ),
  }),
  "reset-model": async (services, person, formData) => ({
    ok: true,
    overview: await services.agentChatControlService.setModel(
      person,
      targetOf(formData),
      null,
    ),
  }),
  new: async (services, person, formData) => {
    await services.agentChatControlService.renew(person, targetOf(formData));
    return { ok: true };
  },
  compact: async (services, person, formData) => {
    await services.agentChatControlService.compact(person, targetOf(formData));
    return { ok: true };
  },
  command: async (services, person, formData) => ({
    ok: true,
    outcome: await services.agentChatCommandService.run(
      person,
      commandChat(formData),
      text(formData, "text"),
    ),
  }),
  members: async (services, person, formData) => ({
    ok: true,
    members: await services.chatGroupMembershipService.members(
      person,
      formData.get("groupId"),
    ),
  }),
  "save-controllers": async (services, person, formData) => ({
    ok: true,
    members: await services.chatGroupMembershipService.saveControllers(
      person,
      formData.get("groupId"),
      readJson(formData, "userIds"),
    ),
  }),
  "remove-member": async (services, person, formData) => {
    const membership = services.chatGroupMembershipService;
    await membership.removeMember(
      person,
      formData.get("groupId"),
      formData.get("memberId"),
    );
    return {
      ok: true,
      members: await membership.members(person, formData.get("groupId")),
    };
  },
  dissolve: async (services, person, formData) => {
    await services.chatGroupMembershipService.dissolve(
      person,
      formData.get("groupId"),
    );
    return { ok: true };
  },
};

function respond(body: AgentChatControlResponse, status: number): Response {
  return Response.json(body, { status, headers: CHAT_NO_STORE });
}

function failed(error: unknown): Response {
  let failure: { code: AgentChatControlFailure; status: number } | undefined;
  if (error instanceof AgentEmployeeError) failure = FAILURES[error.code];
  else if (error instanceof ConversationError)
    failure = CONVERSATION_FAILURES[error.code] ?? FAILURES.invalidInput;
  else throw error;
  logCaughtError("chat_page_agent_control", error);
  return respond(
    { ok: false, error: failure?.code ?? "unavailable" },
    failure?.status ?? 503,
  );
}

/**
 * The control of agents in a chat and of the members of a group:
 * the model choice of an agent in the chat and its reset, `/new`,
 * `/compact`, the typed chat commands, the members of a group, who steers
 * its agents, removing a member and dissolving the group.
 * @remarks
 * Every right is checked on the server: an agent never steers an agent, and
 * only the creator of a group changes its members.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const handler = HANDLERS[text(formData, "intent")];
  if (!handler) return respond({ ok: false, error: "invalidInput" }, 400);
  try {
    const services = await getApplicationServices();
    return respond(await handler(services, person, formData), 200);
  } catch (error: unknown) {
    return failed(error);
  }
}
