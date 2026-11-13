import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type {
  AgentChatSessionAction,
  AgentChatSessionFailure,
  AgentChatSessionResponse,
} from "@/definition/AgentChatSession";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-sessions";

/** The changes the endpoint takes. */
const ACTIONS: readonly AgentChatSessionAction[] = [
  "stop",
  "summarize",
  "restart",
];

const FAILURES: Readonly<
  Partial<Record<string, { code: AgentChatSessionFailure; status: number }>>
> = {
  forbidden: { code: "forbidden", status: 403 },
  notFound: { code: "notFound", status: 404 },
  invalidInput: { code: "invalidInput", status: 400 },
  unavailable: { code: "unavailable", status: 503 },
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function respond(
  body: AgentChatSessionResponse,
  status: number,
): Response {
  return Response.json(body, { status, headers: CHAT_NO_STORE });
}

function failed(error: unknown): Response {
  if (!(error instanceof AgentEmployeeError)) throw error;
  logCaughtError("chat_page_agent_sessions", error);
  const failure = FAILURES[error.code] ?? FAILURES.unavailable;
  return respond(
    { ok: false, error: failure?.code ?? "unavailable" },
    failure?.status ?? 503,
  );
}

async function viewerOf(person: User): Promise<AgentChatSessionViewer> {
  const services = await getApplicationServices();
  const access = await services.administrationService.getContext(person.id);
  return {
    user: person,
    isAdministrator: new UserPolicyService().isAdministrator(access),
  };
}

/**
 * Reads the chat sessions of an agent for the popup "Agent-Einstellungen"
 * (PAGE-376): the viewer sees the sessions of their own chats, an administrator
 * every session of the agent.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const agentId = new URL(request.url).searchParams.get("agentId") ?? "";
  try {
    const services = await getApplicationServices();
    const overview = await services.agentChatSessionService.overview(
      await viewerOf(person),
      agentId,
    );
    return respond({ ok: true, overview }, 200);
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Stops, summarizes or restarts a chat session of an agent, or saves the idle
 * time and the restart threshold of the agent; answers with the sessions as
 * they stand then (PAGE-376).
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const intent = text(formData, "intent");
  const agentId = text(formData, "agentId");
  try {
    const services = await getApplicationServices();
    const viewer = await viewerOf(person);
    const sessions = services.agentChatSessionService;
    const chosen = ACTIONS.find((candidate) => candidate === intent);
    if (chosen)
      await sessions.act(viewer, chosen, text(formData, "sessionId"));
    else if (intent === "save-settings")
      await sessions.saveSettings(viewer, agentId, {
        idleMinutes: formData.get("idleMinutes"),
        restartPercent: formData.get("restartPercent"),
      });
    else return respond({ ok: false, error: "invalidInput" }, 400);
    return respond(
      { ok: true, overview: await sessions.overview(viewer, agentId) },
      200,
    );
  } catch (error: unknown) {
    return failed(error);
  }
}
