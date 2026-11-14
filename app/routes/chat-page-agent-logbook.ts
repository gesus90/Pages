import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type {
  AgentLogbookFailure,
  AgentLogbookResponse,
} from "@/definition/AgentLogbook";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-logbook";

const FAILURES: Readonly<
  Partial<Record<string, { code: AgentLogbookFailure; status: number }>>
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

function respond(body: AgentLogbookResponse, status: number): Response {
  return Response.json(body, { status, headers: CHAT_NO_STORE });
}

function failed(error: unknown): Response {
  if (!(error instanceof AgentEmployeeError)) throw error;
  logCaughtError("chat_page_agent_logbook", error);
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
 * Reads the Lagebuch of an agent for the tab "Lagebuch" of the popup
 * "Agent-Einstellungen" (PAGE-377): the viewer sees the entries of their own
 * chats, an administrator all entries of the agent.
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
    const overview = await services.agentLogbookAdministration.overview(
      await viewerOf(person),
      agentId,
    );
    return respond({ ok: true, overview }, 200);
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Saves the limit, the quiet time and the summary model of an agent
 * (`save-settings`), or removes entries (`remove-entries`, one `entryId` per
 * entry); answers with the Lagebuch as it stands then (PAGE-377).
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
    const logbook = services.agentLogbookAdministration;
    if (intent === "save-settings")
      await logbook.saveSettings(viewer, agentId, {
        limit: formData.get("limit"),
        quietMinutes: formData.get("quietMinutes"),
        modelConnectionId: text(formData, "modelConnectionId"),
        model: text(formData, "model"),
      });
    else if (intent === "remove-entries")
      await logbook.remove(
        viewer,
        agentId,
        formData.getAll("entryId").filter((id) => typeof id === "string"),
      );
    else return respond({ ok: false, error: "invalidInput" }, 400);
    return respond(
      { ok: true, overview: await logbook.overview(viewer, agentId) },
      200,
    );
  } catch (error: unknown) {
    return failed(error);
  }
}
