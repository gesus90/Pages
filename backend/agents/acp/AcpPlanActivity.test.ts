import { expect, it, vi } from "vitest";

import { reportAcpPlanActivity } from "@/backend/agents/acp/AcpPlanActivity";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";

function observer(
  activity?: PlanSessionObserver["activity"],
): PlanSessionObserver {
  return { activity } as unknown as PlanSessionObserver;
}

it("ignores updates that are no plan", () => {
  const activity = vi.fn();
  reportAcpPlanActivity(
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "x" },
    },
    observer(activity),
    (text) => text,
  );
  expect(activity).not.toHaveBeenCalled();
});

it("reports the redacted titles of entries in progress", () => {
  const activity = vi.fn();
  const update: SessionUpdate = {
    sessionUpdate: "plan",
    entries: [
      { content: "secret work", status: "in_progress", priority: "high" },
      { content: "later", status: "pending", priority: "low" },
      { content: "   ", status: "in_progress", priority: "low" },
    ],
  };
  reportAcpPlanActivity(update, observer(activity), (text) =>
    text.replace("secret", "x"),
  );
  expect(activity).toHaveBeenCalledWith({
    reportedAt: expect.any(String) as string,
    titles: ["x work"],
  });
});

it("tolerates an observer without activity callback", () => {
  expect(() =>
    reportAcpPlanActivity(
      { sessionUpdate: "plan", entries: [] },
      observer(),
      (t) => t,
    ),
  ).not.toThrow();
});
