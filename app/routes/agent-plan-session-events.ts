import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  readSessionCursor,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { sessionHistoryStream } from "@/backend/service/agents/sessions/SessionHistoryStream";

import type { Route } from "./+types/agent-plan-session-events";

/** Reads and follows authorized history with a bounded pull stream and a stable reconnect cursor. */
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
    const after = readSessionCursor(
      request.headers.get("Last-Event-ID") ?? search.get("after"),
    );
    const sessions = (await getApplicationServices()).agentSessionService;
    await sessions.view(user.id, key);
    return new Response(
      sessionHistoryStream({
        signal: request.signal,
        after,
        read: (cursor) =>
          sessions.history(user.id, key, { after: cursor, limit: 32 }),
      }),
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_session_events", error);
    return agentFailureResponse(error, "session-follow");
  }
}
