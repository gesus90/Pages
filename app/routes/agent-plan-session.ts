import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  readSessionCursor,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-session";

// The journal serves at most this many events per page.
const PAGE_LIMIT = 200;
// Instructions longer than the journal keeps are refused instead of cut.
const MAXIMUM_INSTRUCTION = 20_000;

/**
 * Reads the PageAgentCLI view of one node attempt and its history after a cursor.
 *
 * @remarks
 * Reading uses the journal only; it starts no process and occupies no slot.
 */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const search = new URL(request.url).searchParams;
    const key = readSessionKey(params, search);
    const sessions = (await getApplicationServices()).agentSessionService;
    const view = await sessions.view(user.id, key);
    const page = await sessions.history(user.id, key, {
      after: readSessionCursor(search.get("after")),
      limit: PAGE_LIMIT,
    });
    return Response.json({ ok: true, view, page }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_plan_session", error);

    return agentFailureResponse(error, "session-read");
  }
}

function readInstruction(input: FormDataEntryValue | null): string {
  if (typeof input !== "string" || input.length > MAXIMUM_INSTRUCTION)
    throw new AgentError("plan_invalid");
  return input;
}

/** Sends an instruction to or cancels the turn or run of the executor's own node session. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData, request } =
      await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    const key = readSessionKey(args.params, new URL(request.url).searchParams);
    const sessions = services.agentSessionService;
    if (intent === "send") {
      const result = await sessions.send(user.id, key, {
        kind: "instruction",
        text: readInstruction(formData.get("text")),
      });
      return Response.json(
        { ok: true, intent, delivery: result.delivery },
        { headers: AGENT_NO_STORE },
      );
    }
    const scope = formData.get("scope");
    if (intent !== "cancel" || (scope !== "turn" && scope !== "run"))
      throw new AgentError("plan_invalid");
    const outcome = await sessions.cancel(user.id, key, scope);
    return Response.json(
      { ok: true, intent, outcome },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_session", error);

    return agentFailureResponse(error, intent);
  }
}
