import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { ChatJobStatus } from "@/app/components/chat/chat-job-status";
import { startChatLiveJob } from "@/app/components/chat/chat-job-state";
import { formatChatElapsed } from "@/app/components/chat/use-chat-elapsed";
import { createI18n } from "@/app/lib/i18n";

import {
  ChatServerFixture,
  FIRST_SESSION,
  installLayoutShims,
  renderChatPanel,
  typeChatMessage,
  waitForSession,
} from "./chat-fixture";

import type { ChatLiveJob } from "@/app/components/chat/chat-job-state";

const START = Date.parse("2026-10-18T12:00:00Z");

function runningJob(): ChatLiveJob {
  return {
    ...startChatLiveJob({
      id: "12345678-1234-4234-8234-123456789abc",
      sessionId: FIRST_SESSION,
      state: "running",
      createdAt: new Date(START).toISOString(),
      endedAt: null,
      errorCode: null,
      usage: { context: null, cost: null, tokens: null },
    }),
    text: "SECRET_PARTIAL",
    tools: [
      {
        kind: "tool",
        callId: "call",
        tool: "SECRET_TOOL",
        status: "running",
        error: null,
      },
    ],
    compaction: {
      kind: "compaction",
      status: "running",
      tokensBefore: 25000,
      tokensAfter: null,
    },
    usage: {
      context: { used: 25000, size: 32000 },
      cost: { amount: 12.34, currency: "EUR", isEstimated: true },
      tokens: null,
    },
  };
}

function status(live: ChatLiveJob, isOpen = true): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("de")}>
      <ChatJobStatus live={live} isOpen={isOpen} />
    </I18nextProvider>
  );
}

afterEach(() => vi.useRealTimers());

it("shows only the mascot, three decorative orange dots, a phrase and elapsed time while a job runs", () => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 84000);
  const { container } = render(status(runningJob()));
  const activity = screen.getByRole("status", {
    name: "Pica bearbeitet deine Anfrage",
  });
  expect(activity.getAttribute("aria-atomic")).toBe("false");
  expect(activity.querySelectorAll("img")).toHaveLength(1);
  const dots = activity.querySelectorAll("[aria-hidden='true'] > span");
  expect(dots).toHaveLength(3);
  for (const dot of dots) {
    expect(dot.classList.contains("bg-primary")).toBe(true);
    expect(dot.classList.contains("motion-reduce:animate-none")).toBe(true);
  }
  expect(
    screen.getByRole("timer", { name: "Verstrichene Bearbeitungszeit" })
      .textContent,
  ).toBe("01:24");
  expect(screen.getByRole("timer").getAttribute("aria-live")).toBe("off");
  expect(container.textContent).not.toMatch(
    /SECRET|25000|32.000|12,34|Compaction|Verbrauch/,
  );
  expect(container.querySelectorAll("dl, ul, pre")).toHaveLength(0);
});

it("ticks each second from createdAt, survives refresh and catches up on reopening", () => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 1000);
  const live = runningJob();
  const rendered = render(status(live));
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("timer").textContent).toBe("00:02");
  rendered.rerender(status({ ...live, cursor: 10, text: "another partial" }));
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByRole("timer").textContent).toBe("00:04");
  rendered.rerender(status(live, false));
  act(() => {
    vi.advanceTimersByTime(9000);
  });
  rendered.rerender(status(live));
  expect(screen.getByRole("timer").textContent).toBe("00:13");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("timer").textContent).toBe("00:14");
});

it.each([
  [0, "00:00"],
  [84, "01:24"],
  [3599, "59:59"],
  [3738, "1:02:18"],
])("formats %s seconds as %s", (seconds, expected) => {
  expect(formatChatElapsed(Number(seconds))).toBe(expected);
});

it.each(["failed", "stopped", "interrupted"] as const)(
  "keeps the actual %s status and the partial answer",
  (state) => {
    render(
      status({
        ...runningJob(),
        ended: {
          kind: "end",
          state,
          errorCode: state === "failed" ? "stepLimit" : null,
        },
      }),
    );
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(screen.getByText("SECRET_PARTIAL")).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText("SECRET_TOOL")).toBeNull();
  },
);

it("uses the local request start for API replies and retains it when the panel is reopened", async () => {
  const removeShims = installLayoutShims();
  const server = new ChatServerFixture();
  vi.stubGlobal("fetch", server.fetch);
  const panel = renderChatPanel();
  await waitForSession(FIRST_SESSION);
  server.hold();
  await typeChatMessage("API request");
  vi.useFakeTimers();
  vi.setSystemTime(START);
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.getByRole("timer").textContent).toBe("00:03");
  panel.setOpen(false);
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  panel.setOpen(true);
  expect(screen.getByRole("timer").textContent).toBe("00:08");
  await act(async () =>
    server.release({ kind: "answer", content: "Final answer" }),
  );
  expect(screen.queryByRole("timer")).toBeNull();
  expect(
    within(screen.getByRole("log")).getByText("Final answer"),
  ).toBeTruthy();
  panel.result.unmount();
  removeShims();
});
