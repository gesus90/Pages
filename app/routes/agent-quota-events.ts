import { authenticatedUserContext } from "@/app/lib/auth.server";
import { claudeQuotaStream } from "@/app/lib/claude-quota-stream.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-quota-events";

/**
 * Pushes the quota figures to the open quota page once a minute.
 * @remarks
 * Only the quota page opens this stream, so no other page causes a read.
 * Every push reads the cards anew with the person's current rights and asks
 * Claude for the current usage of the connections they may use.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const quotas = (await getApplicationServices()).claudeQuotaService;
    return new Response(
      claudeQuotaStream({
        signal: request.signal,
        isReconnect: request.headers.has("Last-Event-ID"),
        read: () => quotas.listForUser(user.id),
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
    logCaughtError("agent_quota_events", error);
    return agentFailureResponse(error, "quota-follow");
  }
}
