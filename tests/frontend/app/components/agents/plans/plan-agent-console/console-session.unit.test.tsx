import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { ConsoleSession } from "@/app/components/agents/plans/plan-agent-console/console-session";
import { useAgentSession } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";
import { useSessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";

import {
  cliSession,
  cliStep,
  renderConsole,
  sessionCommands,
  sessionView,
} from "./console-fixture";
import { SESSION_VIEW, historyEvent } from "../../page161-session-fixture";

import type { AgentSessionData } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionState } from "@/definition/AgentSessionJournal";

vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-agent-session",
  () => ({ useAgentSession: vi.fn() }),
);
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-session-commands",
  () => ({ useSessionCommands: vi.fn() }),
);

const REMOTE_EXECUTION: NonNullable<AgentPlanStepResult["execution"]> = {
  schemaVersion: 1,
  planId: "plan-page161",
  runId: "run-page161",
  stepId: "node",
  attemptId: "00000000-0000-4000-8000-000000000001",
  planRevision: 1,
  target: {
    kind: "remote",
    connectionId: "connection",
    connectionRevision: 1,
    connectionName: "Build host",
    workspaceId: "workspace",
    workspaceRevision: 1,
    workspaceName: "Remote workspace",
    path: "/srv/pages",
  },
  workspace: { id: "workspace", path: "/srv/pages", revision: 1 },
  modelAccess: {
    connectionId: null,
    connectionName: "Codex",
    provider: "codex_cli",
    model: "gpt-5",
    reasoningEffort: null,
  },
};

const REMOTE_PROGRESS: NonNullable<AgentPlanStepResult["remote"]> = {
  jobId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003",
  status: "running",
  liveHistoryVersion: 1,
  outputJournalVersion: 2,
  startedAt: null,
  endedAt: null,
  closeout: "pending",
};

function sessionData(
  overrides: Partial<AgentSessionData> = {},
): AgentSessionData {
  return {
    view: sessionView(),
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

function header(state: AgentSessionState | null): React.ReactNode {
  return <p data-testid="header">{state ?? "no state"}</p>;
}

function renderSession(
  step: AgentPlanStepResult,
  options: { readonly isLive?: boolean; readonly isReadOnly?: boolean } = {},
): void {
  renderConsole(
    <ConsoleSession
      sessionKey={SESSION_VIEW.key}
      step={step}
      isLive={options.isLive ?? false}
      isReadOnly={options.isReadOnly ?? false}
      header={header}
    />,
  );
}

function lastActivity(): string | null {
  const term = screen.getByText("Last activity", { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

beforeEach(() => {
  vi.mocked(useAgentSession).mockReset();
  vi.mocked(useSessionCommands).mockReset();
  vi.mocked(useSessionCommands).mockReturnValue(sessionCommands());
});

it("shows a loading session with an empty header and reads it as a local, settled node", () => {
  const loading = sessionData({ view: null, connection: "loading" });
  vi.mocked(useAgentSession).mockReturnValue(loading);
  const step = cliStep({ status: "succeeded" });
  renderSession(step);
  expect(screen.getByTestId("header").textContent).toBe("no state");
  expect(screen.getByRole("status").textContent).toBe("Loading the session…");
  expect(screen.queryByRole("log")).toBeNull();
  expect(useAgentSession).toHaveBeenCalledWith(SESSION_VIEW.key, {
    isLive: false,
    status: "succeeded",
    isRemote: false,
  });
  expect(useSessionCommands).toHaveBeenCalledWith(
    SESSION_VIEW.key,
    loading.refresh,
  );
});

it("alerts a failed first read with a general fallback for unknown codes", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({ view: null, error: "plan_history_corrupt" }),
  );
  renderSession(cliStep());
  expect(screen.getByRole("alert").textContent).toBe(
    "A history chunk is missing or failed its integrity check.",
  );
});

it("lays out history, composer, controls, usage and facts of a live session", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({ events: [historyEvent(1)] }),
  );
  renderSession(cliStep(), { isLive: true });
  expect(screen.getByTestId("header").textContent).toBe("idle");
  expect(screen.getByText("Live")).toBeTruthy();
  expect(screen.getByRole("log").textContent).toContain("Message 1");
  expect(
    screen.getByRole("textbox", { name: "Instruction to the agent" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("complementary", { name: "Session details" }),
  ).toBeTruthy();
  expect(lastActivity()).toBe(
    new Date("2026-10-26T00:00:00.000Z").toLocaleString(),
  );
  expect(vi.mocked(useAgentSession).mock.calls[0]?.[1].isLive).toBe(true);
});

it("adds a later read error to the connection line and falls back to the record's times", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({ error: "offline", connection: "reconnecting" }),
  );
  renderSession(cliStep(), { isReadOnly: true });
  expect(
    screen.getByText(
      "Connection lost, reconnecting… · Pages cannot be reached. Check the connection; the agent keeps running.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("This run is history and read only.")).toBeTruthy();
  expect(lastActivity()).toBe(
    new Date("2026-10-15T10:00:12.000Z").toLocaleString(),
  );
});

it("uses the start of the session before its first turn ended and unknown without any time", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(cliStep({ session: cliSession({ turnEndedAt: null }) }));
  expect(lastActivity()).toBe(
    new Date("2026-10-15T10:00:00.000Z").toLocaleString(),
  );
});

it("reads unknown activity when the record holds no time", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({
      session: cliSession({ turnEndedAt: null, startedAt: null }),
    }),
  );
  expect(lastActivity()).toBe("unknown");
});

it("draws no session body for a step without a record", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(cliStep({ session: null }));
  expect(screen.getByTestId("header").textContent).toBe("idle");
  expect(screen.queryByRole("log")).toBeNull();
  expect(screen.queryByText("Last activity")).toBeNull();
});

it("explains a running remote one-shot session that cannot continue and follows its live history", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({
      view: sessionView({
        actions: { ...SESSION_VIEW.actions },
        continuation: {
          mode: "unavailable",
          reason: "native_session_ended",
          hasPlanCheckpoint: false,
        },
      }),
    }),
  );
  renderSession(
    cliStep({ execution: REMOTE_EXECUTION, remote: REMOTE_PROGRESS }),
  );
  expect(useAgentSession).toHaveBeenCalledWith(SESSION_VIEW.key, {
    isLive: true,
    status: "running",
    isRemote: true,
  });
  expect(
    screen.getAllByText(
      "This remote agent runs as a one-shot session. Live history is available; additional instructions are unavailable in this session.",
    ),
  ).toHaveLength(2);
});

it("keeps the reported reason of a remote session that has ended or can continue", () => {
  const unavailable = sessionView({
    actions: { ...SESSION_VIEW.actions },
    continuation: {
      mode: "unavailable",
      reason: "native_session_ended",
      hasPlanCheckpoint: false,
    },
  });
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({ view: unavailable }),
  );
  renderSession(
    cliStep({
      status: "succeeded",
      execution: REMOTE_EXECUTION,
      remote: REMOTE_PROGRESS,
    }),
  );
  expect(
    screen.getAllByText("The native session ended with its process."),
  ).toHaveLength(2);
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({ execution: REMOTE_EXECUTION, remote: REMOTE_PROGRESS }),
  );
  expect(
    screen.getAllByText(
      "Same session: the next instruction continues the open native session.",
    ),
  ).toHaveLength(1);
});
