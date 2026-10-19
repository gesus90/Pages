import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";

/** Projects only explicit public ACP plan activity, never thoughts, tool output or inferred TODO matches. */
export function reportAcpPlanActivity(
  update: SessionUpdate,
  observer: PlanSessionObserver,
  redact: (text: string) => string,
): void {
  if (update.sessionUpdate !== "plan") return;
  observer.activity?.({
    reportedAt: new Date().toISOString(),
    titles: update.entries
      .filter((entry) => entry.status === "in_progress")
      .map((entry) =>
        sanitizePlanOutput(redact(entry.content)).trim().slice(0, 4_000),
      )
      .filter(Boolean),
  });
}
