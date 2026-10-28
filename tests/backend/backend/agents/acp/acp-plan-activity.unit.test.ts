import { afterEach, expect, it, vi } from "vitest";

import { reportAcpPlanActivity } from "@/backend/agents/acp/AcpPlanActivity";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanActivity } from "@/definition/AgentPlanProgress";
import type { Mock } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

function observer(): PlanSessionObserver & {
  readonly activity: Mock<(activity: AgentPlanActivity) => void>;
} {
  return {
    started: vi.fn(),
    identified: vi.fn(),
    activity: vi.fn<(activity: AgentPlanActivity) => void>(),
  };
}

it("reports the redacted titles of entries in progress", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
  const target = observer();

  reportAcpPlanActivity(
    {
      sessionUpdate: "plan",
      entries: [
        {
          content: "  Build secret  ",
          priority: "high",
          status: "in_progress",
        },
        { content: "Done step", priority: "low", status: "completed" },
        { content: "   ", priority: "low", status: "in_progress" },
      ],
    },
    target,
    (text) => text.replace("secret", "[hidden]"),
  );

  expect(target.activity).toHaveBeenCalledWith({
    reportedAt: "2026-10-28T10:00:00.000Z",
    titles: ["Build [hidden]"],
  });
});

it("ignores updates that are no plan", () => {
  const target = observer();

  reportAcpPlanActivity(
    { sessionUpdate: "current_mode_update", currentModeId: "ask" },
    target,
    (text) => text,
  );

  expect(target.activity).not.toHaveBeenCalled();
});

it("accepts observers without an activity callback", () => {
  const redact = vi.fn((text: string) => text);

  reportAcpPlanActivity(
    {
      sessionUpdate: "plan",
      entries: [{ content: "Step", priority: "low", status: "in_progress" }],
    },
    { started: vi.fn(), identified: vi.fn() },
    redact,
  );

  expect(redact).not.toHaveBeenCalled();
});
