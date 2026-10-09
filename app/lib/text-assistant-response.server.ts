import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";

export const ASSISTANT_NO_STORE = { "Cache-Control": "no-store" } as const;

/** Maps only stable error codes; raw upstream responses never enter API or logs. */
export function textAssistantFailure(error: unknown): Response {
  if (error instanceof Response) {
    const headers = new Headers(error.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(error.body, { status: error.status, headers });
  }
  if (
    error instanceof AgentAccessDeniedError ||
    error instanceof WikiAccessDeniedError ||
    error instanceof WorkItemAccessDeniedError ||
    error instanceof ProjectAccessDeniedError
  )
    return Response.json(
      { ok: false, error: "accessDenied" },
      { status: 403, headers: ASSISTANT_NO_STORE },
    );
  if (
    error instanceof WikiPageNotFoundError ||
    error instanceof WorkItemNotFoundError ||
    error instanceof ProjectNotFoundError
  )
    return Response.json(
      { ok: false, error: "contextMissing" },
      { status: 404, headers: ASSISTANT_NO_STORE },
    );
  const code =
    error instanceof TextAssistantError ? error.code : "providerFailed";
  const statuses: Readonly<Record<string, number>> = {
    accessDenied: 403,
    versionConflict: 409,
  };
  const status = statuses[code] ?? 400;
  return Response.json(
    { ok: false, error: code },
    { status, headers: ASSISTANT_NO_STORE },
  );
}
