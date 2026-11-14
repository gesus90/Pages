import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-agent-session",
  () => ({ useAgentSession: vi.fn() }),
);
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-session-commands",
  () => ({ useSessionCommands: vi.fn() }),
);
// xterm cannot draw in jsdom; the terminal keeps its section, input and footer.
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-terminal-surface",
  () => ({ useTerminalSurface: () => null, useNow: () => 1_790_000_000_000 }),
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

function header(
  stateLabel: string | null,
  onStopRun: (() => Promise<void>) | undefined,
): React.ReactNode {
  return (
    <>
      <p data-testid="header">{stateLabel ?? "no state"}</p>
      {onStopRun ? (
        <button type="button" onClick={() => void onStopRun()}>
          Stop
        </button>
      ) : null}
    </>
  );
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
      prompt="Write the release notes"
      onClose={() => undefined}
      header={header}
    />,
  );
}

function fact(label: string): string | null {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

function activity(): string | null {
  return (
    screen.getByRole("heading", { name: "Activity" }).nextElementSibling
      ?.textContent ?? null
  );
}

function terminal(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Pages terminal" });
}

beforeEach(() => {
  vi.mocked(useAgentSession).mockReset();
  vi.mocked(useSessionCommands).mockReset();
  vi.mocked(useSessionCommands).mockReturnValue(sessionCommands());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows a loading session with the node's state and reads it as a local, settled node", () => {
  const loading = sessionData({ view: null, connection: "loading" });
  vi.mocked(useAgentSession).mockReturnValue(loading);
  const step = cliStep({ status: "succeeded" });
  renderSession(step);
  expect(screen.getByTestId("header").textContent).toBe("Succeeded");
  expect(screen.getByRole("status").textContent).toBe("Loading the session…");
  expect(terminal()).toBeNull();
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

it("lays out the terminal with its input line and the sidebar of a live session", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(cliStep(), { isLive: true });
  expect(screen.getByTestId("header").textContent).toBe("Idle");
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(terminal()).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Message to the agent" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("textbox", { name: "Instruction to the agent" }),
  ).toBeNull();
  expect(
    screen.getByRole("complementary", { name: "Session details" }),
  ).toBeTruthy();
  for (const title of ["Todos 0 / 0", "Activity", "Usage", "Session"])
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.getByText("No todos")).toBeTruthy();
  expect(activity()).toBe("–");
  expect(fact("Model")).toBe("synthetic-model");
  expect(fact("Total tokens")).toBe("unknown");
  expect(vi.mocked(useAgentSession).mock.calls[0]?.[1].isLive).toBe(true);
});

it("shows no alert for a later read error and closes the input of a read-only history", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({ error: "offline", connection: "reconnecting" }),
  );
  renderSession(cliStep(), { isReadOnly: true });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByText("Session ended, no more input possible"),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("reads the todos and the activity the agent reported before the title of its ACP plan", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({
      progress: {
        source: "live",
        observedAt: "2026-10-15T10:00:05.000Z",
        todos: [
          { id: "a", text: "Read requirements", status: "done" },
          {
            id: "b",
            text: "Implement changes",
            status: "active",
            contractId: "T2",
          },
        ],
        activity: {
          text: "Writing the tests",
          reportedAt: "2026-10-15T10:00:05.000Z",
        },
      },
      session: cliSession({
        activity: {
          reportedAt: "2026-10-15T10:00:04.000Z",
          titles: ["Plan title"],
        },
      }),
    }),
    { isLive: true },
  );
  expect(screen.getByRole("heading", { name: "Todos 1 / 2" })).toBeTruthy();
  const section = screen.getByRole("heading", {
    name: "Todos 1 / 2",
  }).parentElement;
  if (!section) throw new Error("Missing todo section");
  const items = within(section)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(items).toEqual([
    "doneRead requirements",
    "activeT2 Implement changes",
  ]);
  const marks = within(section)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("[data-todo-mark]"));
  expect(marks.map((mark) => mark?.getAttribute("data-todo-mark"))).toEqual([
    "done",
    "active",
  ]);
  expect(
    marks.every((mark) => mark?.getAttribute("aria-hidden") === "true"),
  ).toBe(true);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(activity()).toBe("Writing the tests");
});

it("ticks only the status line and the runtime while a tool runs, and drops both at the end", () => {
  const now = 1_790_000_000_000;
  const at = (milliseconds: number): string =>
    new Date(now - milliseconds).toISOString();
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({
      events: [
        {
          ...historyEvent(1),
          kind: "tool_started",
          text: "Run tests\n@kind execute\n$ pnpm run check",
          createdAt: at(12_000),
        },
      ],
    }),
  );
  renderSession(
    cliStep({ session: cliSession({ startedAt: at(65_000), endedAt: null }) }),
    { isLive: true },
  );
  expect(screen.getByTestId("plan-terminal-status").textContent).toBe(
    "Shellpnpm run checkrunning for 12 s",
  );
  expect(fact("Runtime")).toBe("01:05");
  const facts = screen.getAllByText(/./u, { selector: "dt" });
  expect(
    facts[facts.findIndex((term) => term.textContent === "Runtime") - 1]
      ?.textContent,
  ).toBe("Cost");
  cleanup();
  renderSession(
    cliStep({
      status: "succeeded",
      session: cliSession({ startedAt: at(3_725_000), endedAt: at(0) }),
    }),
    { isLive: true },
  );
  expect(screen.queryByTestId("plan-terminal-status")).toBeNull();
  expect(fact("Runtime")).toBe("1:02:05");
});

it("counts down a planned resume in the status line while the terminal names the planned delay", () => {
  const now = 1_790_000_000_000;
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({
      session: cliSession({
        attemptId: SESSION_VIEW.key.attemptId,
        retry: {
          state: "waiting",
          reason: "transient",
          failureClass: "infrastructure",
          nextAttemptAt: new Date(now + 42_000).toISOString(),
          resetAt: null,
          attempts: [
            {
              attemptId: SESSION_VIEW.key.attemptId,
              sessionId: null,
              endedAt: new Date(now - 18_000).toISOString(),
              code: "provider_unavailable",
              failureClass: "infrastructure",
            },
          ],
        },
      }),
    }),
    { isLive: true },
  );
  expect(screen.getByTestId("plan-terminal-status").textContent).toBe(
    "Resume plannedin 42 s",
  );
});

it("shows that the agent works without a counter when no tool runs", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(cliStep({ session: cliSession({ startedAt: null }) }), {
    isLive: true,
  });
  expect(screen.getByTestId("plan-terminal-status").textContent).toBe(
    "Agent is working",
  );
  expect(fact("Runtime")).toBe("unknown");
});

it("falls back to the title of the ACP plan and reads a finished node as finished", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({
      session: cliSession({
        activity: {
          reportedAt: "2026-10-15T10:00:04.000Z",
          titles: ["Plan title"],
        },
      }),
    }),
    { isLive: true },
  );
  expect(activity()).toBe("Plan title");
  cleanup();
  renderSession(cliStep({ status: "succeeded" }));
  expect(activity()).toBe("Finished");
});

it("draws no session body for a step without a record", () => {
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(cliStep({ session: null }));
  expect(screen.getByTestId("header").textContent).toBe("Idle");
  expect(terminal()).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("follows the live history of a running remote one-shot session that takes no input", () => {
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
    { isLive: true },
  );
  expect(useAgentSession).toHaveBeenCalledWith(SESSION_VIEW.key, {
    isLive: true,
    status: "running",
    isRemote: true,
  });
  expect(terminal()).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByText("Session ended, no more input possible"),
  ).toBeNull();
});

it("closes the input of an ended remote session and offers it while the remote session runs", () => {
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({
      view: sessionView({ actions: { ...SESSION_VIEW.actions } }),
    }),
  );
  renderSession(
    cliStep({
      status: "succeeded",
      execution: REMOTE_EXECUTION,
      remote: REMOTE_PROGRESS,
    }),
    { isLive: true },
  );
  expect(screen.getByTestId("header").textContent).toBe("Succeeded");
  expect(
    screen.getByText("Session ended, no more input possible"),
  ).toBeTruthy();
  cleanup();
  vi.mocked(useAgentSession).mockReturnValue(sessionData());
  renderSession(
    cliStep({ execution: REMOTE_EXECUTION, remote: REMOTE_PROGRESS }),
    { isLive: true },
  );
  expect(
    screen.getByRole("textbox", { name: "Message to the agent" }),
  ).toBeTruthy();
});

it("types in the field below the terminal on compact widths and stops the run from the header", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const commands = sessionCommands();
  vi.mocked(useSessionCommands).mockReturnValue(commands);
  vi.mocked(useAgentSession).mockReturnValue(
    sessionData({
      view: sessionView({
        state: "running",
        actions: {
          canSend: true,
          canCancelRun: true,
          canCancelTurn: true,
          canRecover: false,
        },
      }),
    }),
  );
  renderSession(cliStep(), { isLive: true });
  expect(screen.getByTestId("header").textContent).toBe("Turn running");
  expect(
    screen.queryByRole("textbox", { name: "Message to the agent" }),
  ).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Instruction to the agent" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Interrupt the step" }));
  expect(commands.cancel).toHaveBeenCalledWith("turn");
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(commands.cancel).toHaveBeenCalledWith("run");
});
