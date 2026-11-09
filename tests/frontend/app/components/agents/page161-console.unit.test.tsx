import { I18nextProvider } from "react-i18next";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { ConsoleFailure } from "@/app/components/agents/plans/plan-agent-console/console-failure";
import { ConsoleTerminal } from "@/app/components/agents/plans/plan-agent-console/console-terminal";
import { mergeEvents } from "@/app/components/agents/plans/plan-agent-console/session-client";
import { useAgentSession } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";
import { createI18n } from "@/app/lib/i18n";

import {
  SESSION_VIEW,
  SessionEventSource,
  historyEvent,
} from "./page161-session-fixture";
import {
  cliStep,
  sessionCommands,
} from "./plans/plan-agent-console/console-fixture";

import type { TerminalInputMode } from "@/app/components/agents/plans/plan-agent-console/console-terminal";
import type { AgentSessionData } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";

// xterm cannot draw in jsdom; the terminal keeps its section, input and footer.
vi.mock(
  "@/app/components/agents/plans/plan-agent-console/use-terminal-surface",
  () => ({ useTerminalSurface: () => null, useNow: () => 1_790_000_000_000 }),
);

const i18n = createI18n("en");

beforeEach(() => {
  SessionEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", SessionEventSource);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: new EventTarget(),
  });
  window.getSelection()?.removeAllRanges();
});

function page(first: number, last: number, hasEarlier = true): Response {
  return Response.json({
    ok: true,
    view: SESSION_VIEW,
    page: {
      events: Array.from({ length: last - first + 1 }, (_, index) =>
        historyEvent(first + index),
      ),
      cursor: last,
      hasMore: false,
      hasEarlier,
      retainedFrom: null,
      source: "journal",
    },
  });
}

it("opens with a tail, holds 150 entries, loads older events by exclusive cursor and freezes while reading", async () => {
  const fetchPage = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
    async () => page(1, 200, false),
  );
  vi.stubGlobal("fetch", fetchPage);
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, {
      isLive: true,
      status: "running",
      isRemote: true,
    }),
  );
  expect(SessionEventSource.instances).toHaveLength(0);
  await waitFor(() => expect(result.current.events).toHaveLength(150));
  expect(String(fetchPage.mock.calls[0]?.[0])).toContain("tail=1");
  expect(result.current.events[0]?.sequence).toBe(51);
  expect(result.current.hasEarlier).toBe(true);
  const source = SessionEventSource.instances[0];
  if (!source) throw new Error("Stream not opened");
  expect(source.url).toContain("after=200");
  act(() => {
    for (let sequence = 201; sequence <= 400; sequence += 1)
      source.send(sequence);
  });
  expect(result.current.events).toHaveLength(150);
  expect(result.current.events[0]?.sequence).toBe(251);
  fetchPage.mockImplementation(async () => page(101, 250));
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(result.current.events[0]?.sequence).toBe(101));
  expect(String(fetchPage.mock.calls.at(-1)?.[0])).toContain("before=251");
  act(() => source.send(401));
  expect(result.current.events.at(-1)?.sequence).toBe(250);
  expect(result.current.isFollowing).toBe(false);
  fetchPage.mockImplementation(async () => page(252, 401));
  act(() => result.current.followLatest());
  await waitFor(() => expect(result.current.events.at(-1)?.sequence).toBe(401));
  expect(result.current.events).toHaveLength(150);
});

it("keeps selection and the old window stable and reports gaps and missing history", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      page(1, 150),
    ),
  );
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: true, status: "running" }),
  );
  await waitFor(() => expect(result.current.events).toHaveLength(150));
  const text = document.createTextNode("selected old output");
  document.body.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection()?.addRange(range);
  const source = SessionEventSource.instances[0];
  if (!source) throw new Error("Stream not opened");
  act(() => source.send(151));
  expect(result.current.events[0]?.sequence).toBe(1);
  expect(result.current.isFollowing).toBe(false);
  expect(window.getSelection()?.toString()).toBe("selected old output");
  act(() => source.send(153));
  expect(result.current.error).toBe("plan_history_corrupt");
  expect(source.readyState).toBe(SessionEventSource.CLOSED);
  text.remove();
  window.getSelection()?.removeAllRanges();
});

it("puts the bounded session history into the Pages terminal with its input line or end", () => {
  const events = Array.from({ length: 200 }, (_, index) =>
    historyEvent(index + 1),
  );
  const session: AgentSessionData = {
    view: SESSION_VIEW,
    events,
    source: "journal",
    retainedFrom: 5,
    hasEarlier: true,
    error: null,
    connection: "live",
    isHistoryLoading: false,
    isFollowing: true,
    refresh: vi.fn(),
    loadEarlier: vi.fn(),
    followLatest: vi.fn(),
    stopFollowing: vi.fn(),
    downloadAddress: "/authorized/download",
  };
  function terminal(inputMode: TerminalInputMode): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <ConsoleTerminal
          sessionKey={SESSION_VIEW.key}
          step={cliStep()}
          session={session}
          commands={sessionCommands()}
          provider="Codex CLI"
          model="gpt-5"
          prompt="Write the release notes"
          inputMode={inputMode}
          canInterrupt
          onCloseRequest={vi.fn()}
        />
      </I18nextProvider>
    );
  }
  const { rerender } = render(terminal("line"));
  const section = screen.getByRole("region", { name: "Pages terminal" });
  expect(section.querySelector("[data-testid='plan-terminal']")).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Message to the agent" }),
  ).toBeTruthy();
  expect(
    screen.getByText("Enter sends · Shift+Enter new line · Ctrl+C interrupts"),
  ).toBeTruthy();
  rerender(terminal("ended"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByText("Session ended, no more input possible"),
  ).toBeTruthy();
  rerender(terminal("none"));
  expect(
    screen.queryByText("Session ended, no more input possible"),
  ).toBeNull();
});

it("deduplicates overlapping pages without dropping unseen entries and surfaces failed older reads", async () => {
  expect(
    mergeEvents(
      [historyEvent(1), historyEvent(3)],
      [historyEvent(2), historyEvent(3)],
    ).map((entry) => entry.sequence),
  ).toEqual([1, 2, 3]);
  const fetchPage = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
    async () => page(101, 250),
  );
  vi.stubGlobal("fetch", fetchPage);
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: false, status: "completed" }),
  );
  await waitFor(() => expect(result.current.events).toHaveLength(150));
  fetchPage.mockImplementation(async () =>
    Response.json(
      { ok: false, error: "plan_history_corrupt" },
      { status: 500 },
    ),
  );
  act(() => result.current.loadEarlier());
  await waitFor(() =>
    expect(result.current.error).toBe("plan_history_corrupt"),
  );
  expect(result.current.events[0]?.sequence).toBe(101);
  expect(result.current.isHistoryLoading).toBe(false);
});

it("shows the concrete history storage failure without discarding the confirmed console window", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ConsoleFailure remote={{ reason: "storage", storageError: "ENOSPC" }} />
    </I18nextProvider>,
  );
  expect(screen.getByRole("alert").textContent).toContain("ENOSPC");
  expect(screen.getByRole("alert").textContent).toContain(
    "Confirmed output has been preserved",
  );
});
