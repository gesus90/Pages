import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentChatSessionViewer } from "@/backend/service/employee/AgentChatSessionService";
import type { AgentLessonsAdministration } from "@/backend/service/employee/AgentLessonsAdministration";
import type {
  AgentDreamingFailure,
  AgentLessonsResponse,
} from "@/definition/AgentDreaming";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-lessons";

const FAILURES: Readonly<
  Partial<Record<string, { code: AgentDreamingFailure; status: number }>>
> = {
  forbidden: { code: "forbidden", status: 403 },
  notFound: { code: "notFound", status: 404 },
  invalidInput: { code: "invalidInput", status: 400 },
  conflict: { code: "conflict", status: 409 },
  unavailable: { code: "unavailable", status: 503 },
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function respond(body: AgentLessonsResponse, status: number): Response {
  return Response.json(body, { status, headers: CHAT_NO_STORE });
}

function failed(error: unknown): Response {
  if (!(error instanceof AgentEmployeeError)) throw error;
  logCaughtError("chat_page_agent_lessons", error);
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

/** Runs the change an `intent` names; `false` for an intent that is none. */
async function change(
  lessons: AgentLessonsAdministration,
  call: {
    readonly viewer: AgentChatSessionViewer;
    readonly agentId: string;
    readonly intent: string;
    readonly formData: FormData;
  },
): Promise<boolean> {
  const { viewer, agentId, formData } = call;
  const isActive = text(formData, "active") === "true";
  switch (call.intent) {
    case "save-lesson":
      await lessons.saveLesson(viewer, agentId, {
        lessonId: text(formData, "lessonId"),
        text: text(formData, "text"),
        evidence: text(formData, "evidence"),
      });
      return true;
    case "set-lesson-active":
      await lessons.setLessonActive(viewer, agentId, {
        id: text(formData, "lessonId"),
        isActive,
      });
      return true;
    case "remove-lesson":
      await lessons.removeLesson(viewer, agentId, text(formData, "lessonId"));
      return true;
    case "save-recipe":
      await lessons.saveRecipe(viewer, agentId, {
        recipeId: text(formData, "recipeId"),
        name: text(formData, "name"),
        summary: text(formData, "summary"),
        keywords: text(formData, "keywords"),
        body: text(formData, "body"),
        parameters: text(formData, "parameters"),
        steps: text(formData, "steps"),
      });
      return true;
    case "set-recipe-active":
      await lessons.setRecipeActive(viewer, agentId, {
        id: text(formData, "recipeId"),
        isActive,
      });
      return true;
    case "remove-recipe":
      await lessons.removeRecipe(viewer, agentId, text(formData, "recipeId"));
      return true;
    default:
      return false;
  }
}

/**
 * Reads the lessons and recipes of an agent for the tab "Lektionen & Rezepte"
 * of the popup "Agent-Einstellungen" (PAGE-378); only an administrator gets
 * them, everybody else gets empty lists.
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
    const overview = await services.agentLessonsAdministration.overview(
      await viewerOf(person),
      agentId,
    );
    return respond({ ok: true, overview }, 200);
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Changes lessons and recipes (`save-lesson`, `set-lesson-active`,
 * `remove-lesson`, `save-recipe`, `set-recipe-active`, `remove-recipe`) and
 * answers with the overview as it stands then (PAGE-378).
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const agentId = text(formData, "agentId");
  try {
    const services = await getApplicationServices();
    const viewer = await viewerOf(person);
    const lessons = services.agentLessonsAdministration;
    const isChanged = await change(lessons, {
      viewer,
      agentId,
      intent: text(formData, "intent"),
      formData,
    });
    if (!isChanged) return respond({ ok: false, error: "invalidInput" }, 400);
    return respond(
      { ok: true, overview: await lessons.overview(viewer, agentId) },
      200,
    );
  } catch (error: unknown) {
    return failed(error);
  }
}
