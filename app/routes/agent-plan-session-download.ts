import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readSessionKey } from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { sessionHistoryDownload } from "@/backend/service/agents/sessions/SessionHistoryStream";

import type { Route } from "./+types/agent-plan-session-download";

/** Exports the full allowed public journal from chunks; every page rechecks current run and attempt access. */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const key = readSessionKey(params, new URL(request.url).searchParams);
    const sessions = (await getApplicationServices()).agentSessionService;
    const tail = await sessions.history(user.id, key, {
      after: 0,
      tail: true,
      limit: 1,
    });
    const lastSequence = tail.cursor ?? 0;
    return new Response(
      sessionHistoryDownload({
        signal: request.signal,
        lastSequence,
        read: (after) => sessions.history(user.id, key, { after, limit: 32 }),
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="agent-history.txt"',
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_session_download", error);
    return agentFailureResponse(error, "session-download");
  }
}
