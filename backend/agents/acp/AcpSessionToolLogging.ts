import { logEvent } from "@/backend/logging/Logger";

import type { SessionUpdate } from "@agentclientprotocol/sdk";

/** Logs only the lifecycle fields of an ACP tool update. */
export function logAcpToolUpdate(
  update: SessionUpdate,
  sessionId: string | null,
): void {
  if (
    update.sessionUpdate !== "tool_call" &&
    update.sessionUpdate !== "tool_call_update"
  )
    return;
  logEvent({
    level: update.status === "failed" ? "warn" : "debug",
    event: "acp.tool.updated",
    component: "AcpSession",
    message: "ACP tool lifecycle update",
    metadata: {
      sessionId,
      toolId: update.toolCallId,
      status: update.status,
      kind: update.sessionUpdate,
    },
  });
}
