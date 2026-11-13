import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type {
  AgentDreamingFailure,
  AgentDreamingResponse,
} from "@/definition/AgentDreaming";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-dreaming";

const FAILURES: Readonly<
  Partial<Record<string, { code: AgentDreamingFailure; status: number }>>
> = {
  forbidden: { code: "forbidden", status: 403 },
  notFound: { code: "notFound", status: 404 },
  invalidInput: { code: "invalidInput", status: 400 },
  conflict: { code: "conflict", status: 409 },
  inactive: { code: "invalidInput", status: 400 },
  unavailable: { code: "unavailable", status: 503 },
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function respond(body: AgentDreamingResponse, status: number): Response {
  return Response.json(body, { status, headers: CHAT_NO_STORE });
}

function failed(error: unknown): Response {
  if (!(error instanceof AgentEmployeeError)) throw error;
  logCaughtError("chat_page_agent_dreaming", error);
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
 * Reads the Dreaming of an agent for the tab "Dreaming" of the popup
 * "Agent-Einstellungen" (PAGE-378): everybody sees the schedule and when the
 * agent dreams, an administrator also the log of the last run and the files.
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
    const overview = await services.agentDreamingAdministration.overview(
      await viewerOf(person),
      agentId,
    );
    return respond({ ok: true, overview }, 200);
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Saves the schedule and the model of the dream run of an agent
 * (`save-settings`), or starts a run now (`run-now`); answers with the
 * Dreaming as it stands then (PAGE-378).
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
    const dreaming = services.agentDreamingAdministration;
    if (intent === "save-settings") {
      await dreaming.saveSettings(viewer, agentId, {
        enabled: text(formData, "enabled"),
        interval: text(formData, "interval"),
        unit: text(formData, "unit"),
        time: text(formData, "time"),
        weekday: text(formData, "weekday"),
        onFullLogbook: text(formData, "onFullLogbook"),
        modelConnectionId: text(formData, "modelConnectionId"),
        model: text(formData, "model"),
      });
      return respond(
        { ok: true, overview: await dreaming.overview(viewer, agentId) },
        200,
      );
    }
    if (intent !== "run-now")
      return respond({ ok: false, error: "invalidInput" }, 400);
    const run = await dreaming.runNow(viewer, agentId);
    return respond(
      { ok: true, overview: await dreaming.overview(viewer, agentId), run },
      200,
    );
  } catch (error: unknown) {
    return failed(error);
  }
}
