import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PlanRemoteHistory } from "@/app/components/agents/plans/plan-remote-history";

import {
  agentSession,
  i18n,
  REMOTE_TARGET,
  remoteProgress,
  renderTranslated,
  runStep,
  stepExecution,
} from "./plan-panel-fixture";

import type { AgentSessionData } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

const session = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-agent-session",
  () => ({ useAgentSession: session.read }),
);

afterEach(() => session.read.mockReset());

function sessionData(
  overrides: Partial<AgentSessionData> = {},
): AgentSessionData {
  return {
    view: null,
    events: [],
    source: "journal",
    retainedFrom: null,
    hasEarlier: false,
    error: null,
    connection: "live",
    isHistoryLoading: false,
    isFollowing: true,
    refresh: vi.fn(),
    loadEarlier: vi.fn(),
    followLatest: vi.fn(),
    stopFollowing: vi.fn(),
    downloadAddress: "/download",
    ...overrides,
  };
}

function event(sequence: number, text: string): AgentSessionEvent {
  return {
    id: `attempt:${sequence}`,
    sequence,
    stepId: "step",
    attemptId: "attempt",
    turn: 1,
    kind: "agent_message",
    createdAt: "2026-10-15T10:00:00.000Z",
    text,
    isTruncated: false,
  };
}

function remoteStep(
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return runStep("step", {
    status: "running",
    execution: stepExecution(REMOTE_TARGET),
    session: agentSession("codex_cli", { attemptId: "attempt" }),
    remote: remoteProgress({ liveHistoryVersion: 1 }),
    ...overrides,
  });
}

it("shows the last eight remote events of the attempt, each cut to 500 characters", () => {
  session.read.mockReturnValue(
    sessionData({
      events: [
        ...Array.from({ length: 8 }, (_, index) =>
          event(index + 1, `Event ${index + 1}`),
        ),
        event(9, "x".repeat(501)),
      ],
    }),
  );
  renderTranslated(<PlanRemoteHistory step={remoteStep()} />);
  const items = screen.getAllByRole("listitem");

  expect(session.read).toHaveBeenCalledWith(
    { planId: "plan", runId: "run-1", stepId: "step", attemptId: "attempt" },
    { isLive: true, status: "running", isRemote: true },
  );
  expect(items).toHaveLength(8);
  expect(items[0].textContent).toContain("Event 2");
  expect(items[7].textContent).toBe(
    `${i18n.t("plans.console.kind.agent_message")}${"x".repeat(500)}…`,
  );
  expect(screen.getByText(i18n.t("plans.console.remoteHistory"))).toBeDefined();
  expect(screen.queryByRole("status")).toBeNull();
});

it("says while loading, without events and after a read failure", () => {
  session.read.mockReturnValue(sessionData({ connection: "loading" }));
  const view = renderTranslated(<PlanRemoteHistory step={remoteStep()} />);
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.console.loading"),
  );
  view.unmount();

  session.read.mockReturnValue(
    sessionData({ error: "synthetic_unknown", events: [event(1, "Short")] }),
  );
  const failed = renderTranslated(<PlanRemoteHistory step={remoteStep()} />);
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("settings.agents.error.general"),
  );
  expect(screen.getByRole("listitem").textContent).toContain("Short");
  failed.unmount();

  session.read.mockReturnValue(sessionData());
  renderTranslated(<PlanRemoteHistory step={remoteStep()} />);

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.console.noEvents"),
  );
});

it("explains that an older remote runner keeps no live history", () => {
  renderTranslated(
    <PlanRemoteHistory step={remoteStep({ remote: remoteProgress() })} />,
  );

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.console.outputUpgrade"),
  );
  expect(session.read).not.toHaveBeenCalled();
});

it.each<[string, Partial<AgentPlanStepResult>]>([
  ["a local step", { execution: stepExecution(), remote: undefined }],
  ["a step without execution", { execution: undefined }],
  ["a step without session", { session: null, remote: remoteProgress() }],
  [
    "a request runner",
    {
      session: agentSession("api", { attemptId: "attempt" }),
      remote: remoteProgress(),
    },
  ],
  [
    "a runner with the current output journal",
    { remote: remoteProgress({ outputJournalVersion: 2 }) },
  ],
  [
    "a live-history step without attempt",
    {
      session: agentSession("claude_code"),
      remote: remoteProgress({
        liveHistoryVersion: 1,
        outputJournalVersion: 2,
      }),
    },
  ],
])("shows nothing for %s", (name, overrides) => {
  const { container } = renderTranslated(
    <PlanRemoteHistory step={remoteStep(overrides)} />,
  );

  expect(container.textContent).toBe("");
  expect(session.read).not.toHaveBeenCalled();
});
