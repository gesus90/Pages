import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { logEvent } from "@/backend/logging/Logger";

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { AcpSessionState } from "./AcpEvents";
import type { AcpSessionContext } from "./AcpSessionContracts";

/**
 * Answers a permission request of the adapter of one session.
 * @param context - The profile of the session and, for a Claude Code chat, its helper.
 * @param state - The state that counts and notes every refusal.
 * @param request - The request of the adapter.
 * @returns The selected option.
 * @remarks
 * A Claude Code chat in "Nur Lesen" approves only the exact helper call of
 * its turn. A chat in YOLO mode, which only an agent employee on
 * "Arbeitsplatz" or YOLO reaches, keeps the decisions of
 * its profile, as every plan node does.
 */
export function decideAcpSessionPermission(
  context: Pick<AcpSessionContext, "listener" | "profile" | "picaSupport">,
  state: AcpSessionState,
  request: RequestPermissionRequest,
): RequestPermissionResponse {
  const decision = sessionPermission(context, request);
  if (decision.isDenied) {
    logEvent({
      level: "warn",
      event: "acp.permission.denied",
      component: "AcpSession",
      message: "ACP tool permission denied",
      metadata: { sessionId: state.sessionId },
    });
    state.permissionDenials += 1;
    noteSessionEvent(
      state.events,
      `refused ${request.toolCall.title ?? request.toolCall.kind ?? "request"}`,
    );
  }
  return { outcome: decision.outcome };
}

function sessionPermission(
  context: Pick<AcpSessionContext, "listener" | "profile" | "picaSupport">,
  request: RequestPermissionRequest,
): ReturnType<AcpSessionContext["profile"]["decide"]> {
  const helperPath = context.listener?.picaHelper;
  if (!helperPath || context.profile.mode === "yolo")
    return context.profile.decide(request);
  if (!context.picaSupport)
    throw new Error("Pica permission support is missing");
  return context.picaSupport.decideHelperPermission(request, helperPath());
}
