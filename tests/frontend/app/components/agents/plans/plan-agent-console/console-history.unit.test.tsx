import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ConsoleHistory } from "@/app/components/agents/plans/plan-agent-console/console-history";

import { renderConsole } from "./console-fixture";
import { historyEvent } from "../../page161-session-fixture";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

function navigation(
  overrides: Partial<Parameters<typeof ConsoleHistory>[0]["navigation"]> = {},
): Parameters<typeof ConsoleHistory>[0]["navigation"] {
  return {
    hasEarlier: false,
    isHistoryLoading: false,
    isFollowing: true,
    loadEarlier: vi.fn(),
    followLatest: vi.fn(),
    stopFollowing: vi.fn(),
    downloadAddress: "/download",
    ...overrides,
  };
}

function event(
  sequence: number,
  overrides: Partial<AgentSessionEvent> = {},
): AgentSessionEvent {
  return { ...historyEvent(sequence), ...overrides };
}

function viewport(): HTMLElement {
  const element = screen.getByRole("log").parentElement;
  if (!element) throw new Error("Viewport missing");
  return element;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

it("says that nothing was written yet and marks a legacy record", () => {
  renderConsole(
    <ConsoleHistory
      events={[]}
      source="legacy_record"
      retainedFrom={null}
      navigation={navigation()}
    />,
  );
  expect(screen.getByText("No entries yet.")).toBeTruthy();
  expect(
    screen.getByText(
      "Run from before structured histories: only the short event lines of the record are known.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Load earlier history")).toBeNull();
  expect(screen.queryByText("Follow latest output")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("renders entries as text with kind, turn, shortened mark and collapsed long tool output", () => {
  const longOutput = "x".repeat(601);
  renderConsole(
    <ConsoleHistory
      events={[
        event(1, { kind: "status", turn: null, text: "<b>prepared</b>" }),
        event(2, { kind: "tool_completed", text: "short tool output" }),
        event(3, {
          kind: "tool_failed",
          text: longOutput,
          isTruncated: true,
        }),
      ]}
      source="journal"
      retainedFrom={null}
      navigation={navigation()}
    />,
  );
  const entries = screen.getAllByRole("listitem");
  expect(entries[0]?.textContent).toBe(
    "Status2026-10-26T00:00:00.000Z<b>prepared</b>",
  );
  expect(entries[1]?.textContent).toContain("Tool finishedTurn 1");
  expect(entries[1]?.querySelector("details")).toBeNull();
  const details = entries[2]?.querySelector("details");
  expect(details?.querySelector("summary")?.textContent).toBe(
    "Show tool output (601 characters)",
  );
  expect(details?.querySelector("pre")?.textContent).toBe(longOutput);
  expect(entries[2]?.textContent).toContain("Shortened to the storage limit.");
});

it("follows the newest entry only while following and nothing is selected", () => {
  const { rerender } = renderConsole(
    <ConsoleHistory
      events={[event(1)]}
      source="journal"
      retainedFrom={null}
      navigation={navigation()}
    />,
  );
  const element = viewport();
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: 900,
  });
  rerender(
    <ConsoleHistory
      events={[event(1), event(2)]}
      source="journal"
      retainedFrom={null}
      navigation={navigation()}
    />,
  );
  expect(element.scrollTop).toBe(900);
  element.scrollTop = 10;
  const text = document.createTextNode("kept selection");
  document.body.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection()?.addRange(range);
  rerender(
    <ConsoleHistory
      events={[event(1), event(2), event(3)]}
      source="journal"
      retainedFrom={null}
      navigation={navigation()}
    />,
  );
  expect(element.scrollTop).toBe(10);
  window.getSelection()?.removeAllRanges();
  rerender(
    <ConsoleHistory
      events={[event(1), event(2), event(3), event(4)]}
      source="journal"
      retainedFrom={null}
      navigation={navigation({ isFollowing: false })}
    />,
  );
  expect(element.scrollTop).toBe(10);
  text.remove();
});

it("keeps following while the reader scrolls near the end and offers earlier history", () => {
  const stopFollowing = vi.fn();
  const loadEarlier = vi.fn();
  renderConsole(
    <ConsoleHistory
      events={[event(1)]}
      source="journal"
      retainedFrom={1}
      navigation={navigation({ stopFollowing, loadEarlier, hasEarlier: true })}
    />,
  );
  expect(
    screen.getByText("Older entries were removed by the retention limit."),
  ).toBeTruthy();
  const element = viewport();
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
  });
  fireEvent.scroll(element, { target: { scrollTop: 880 } });
  expect(stopFollowing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load earlier history" }));
  expect(loadEarlier).toHaveBeenCalledOnce();
});
