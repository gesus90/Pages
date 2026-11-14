import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { ChatPageComposer } from "@/app/components/chat-page/chat-page-composer";
import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { ChatPageActivityRow } from "@/app/components/chat-page/live/chat-page-activity-row";
import { createI18n } from "@/app/lib/i18n";

import { installLayoutShims } from "../../chat/chat-fixture";
import { message, participant } from "../chat-page-fixture";

import type { HistoryLive } from "@/app/components/chat-page/chat-page-history";
import type { LiveAnswerView } from "@/app/components/chat-page/live/live-answer-state";

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

let removeShims = (): void => undefined;
beforeAll(() => {
  removeShims = installLayoutShims();
});
afterAll(() => removeShims());

const de = createI18n("de");
const ED = participant("ed", { name: "Ed", role: "Entwickler" });

function view(overrides: Partial<LiveAnswerView> = {}): LiveAnswerView {
  return {
    answerId: "a1",
    chatKind: "agent",
    chatId: "ed",
    agentId: "ed",
    seq: 3,
    startedAt: "2026-11-14T10:00:00.000Z",
    lastAt: "2026-11-14T10:00:12.000Z",
    text: "",
    thought: null,
    tools: [],
    end: null,
    ...overrides,
  };
}

function live(overrides: Partial<HistoryLive> = {}): HistoryLive {
  return {
    answers: [],
    ended: new Map(),
    deliveries: {},
    nameOf: (id) => (id === "ed" ? "Ed" : id),
    ...overrides,
  };
}

function renderHistory(
  props: Partial<React.ComponentProps<typeof ChatPageHistory>>,
): void {
  render(
    <I18nextProvider i18n={de}>
      <ChatPageHistory
        messages={[]}
        name="Ed"
        findParticipant={(id) => (id === "ed" ? ED : undefined)}
        {...props}
      />
    </I18nextProvider>,
  );
}

it("shows the answer while it is written, with a caret, its thoughts for the reader and its running tools", () => {
  const onCancelTool = vi.fn();
  renderHistory({
    isAnswering: true,
    live: live({
      onCancelTool,
      modelOf: () => "Claude Opus 5.5 · hoch",
      answers: [
        view({
          text: "Ich lese die Datei",
          lastAt: "2026-11-14T10:00:12.000Z",
          thought: {
            text: "Erst den Code lesen",
            startedAt: "2026-11-14T10:00:00.000Z",
            endedAt: "2026-11-14T10:00:02.000Z",
          },
          tools: [
            {
              callId: "c1",
              name: "Read",
              status: "running",
              input: "ConversationEvents.ts",
              startedAt: "2026-11-14T10:00:03.000Z",
            },
          ],
        }),
      ],
    }),
  });
  const answer = screen.getByRole("article", {
    name: "Antwort von Ed, wird geschrieben",
  });
  expect(within(answer).getByText("Claude Opus 5.5 · hoch")).toBeTruthy();
  expect(answer.textContent).toContain("Ich lese die Datei▍");
  // The thinking ended: folded, with its time, for the reader alone.
  expect(within(answer).getByText(/Gedanken · 2,0 s/u)).toBeTruthy();
  expect(within(answer).getByText("nur für dich sichtbar")).toBeTruthy();
  fireEvent.click(within(answer).getByRole("button", { name: /Abbrechen/u }));
  expect(onCancelTool).toHaveBeenCalledWith("ed");
  // The plain "Ed antwortet …" line gives way to the live answer.
  expect(screen.queryByText("Ed antwortet …")).toBeNull();
});

it("says that the agent thinks while it does, with the hint that only the reader sees it", () => {
  renderHistory({
    live: live({
      answers: [
        view({
          lastAt: "2026-11-14T10:00:05.000Z",
          thought: {
            text: "…",
            startedAt: "2026-11-14T10:00:00.000Z",
            endedAt: "2026-11-14T10:00:05.000Z",
          },
        }),
      ],
    }),
  });
  expect(screen.getByText("Denkt nach …")).toBeTruthy();
  expect(screen.getByText("nur für dich sichtbar")).toBeTruthy();
});

it("replaces the live answer by the stored message, with folded thoughts and one tool entry under it", () => {
  const ended = view({
    text: "Fertig",
    end: { messageId: "m1", state: "answered" },
    thought: {
      text: "Kurz nachgedacht",
      startedAt: "2026-11-14T10:00:00.000Z",
      endedAt: "2026-11-14T10:00:12.000Z",
    },
    tools: [
      {
        callId: "c1",
        name: "Read",
        status: "completed",
        startedAt: "2026-11-14T10:00:12.000Z",
        endedAt: "2026-11-14T10:00:13.000Z",
      },
      {
        callId: "c2",
        name: "Bash",
        status: "failed",
        startedAt: "2026-11-14T10:00:13.000Z",
        endedAt: "2026-11-14T10:00:15.100Z",
      },
    ],
  });
  renderHistory({
    messages: [{ ...message("m1"), authorId: "ed", content: "Fertig" }],
    live: live({ answers: [], ended: new Map([["m1", ended]]) }),
  });
  expect(screen.getAllByText("Fertig")).toHaveLength(1);
  expect(screen.queryByRole("article", { name: /wird geschrieben/u })).toBeNull();
  const thoughts = screen.getByText(/Gedanken · 12 s/u).closest("details");
  expect(thoughts?.open).toBe(false);
  const tools = screen.getByText("2 Werkzeuge · 3,1 s").closest("details");
  expect(tools?.open).toBe(false);
  expect(within(tools as HTMLElement).getByText("Bash")).toBeTruthy();
});

it("marks a message steered into the answer and one that waits for it", () => {
  renderHistory({
    messages: [
      { ...message("m1"), authorId: null, content: "Nimm B", steeredInto: ["ed"] },
      { ...message("m2"), authorId: null, content: "Danach noch C", queue: "chat" },
      { ...message("m3"), authorId: null, content: "Und D" },
    ],
    live: live({ deliveries: { m3: { delivery: "waiting", agentId: "ed" } } }),
  });
  expect(screen.getByText("in Eds Antwort eingeschoben")).toBeTruthy();
  expect(screen.getByText("wartet · geht nach der laufenden Antwort raus")).toBeTruthy();
  expect(screen.getByText("wartet · geht nach Eds Antwort raus")).toBeTruthy();
});

it("names every agent at work and what it does", () => {
  render(
    <I18nextProvider i18n={de}>
      <ChatPageActivityRow
        entries={[
          {
            agent: ED,
            activity: { kind: "tool", action: "read", target: "ConversationEvents.ts", running: 1 },
          },
          {
            agent: participant("mei", { name: "Mei" }),
            activity: { kind: "tool", action: "test", target: "", running: 1 },
          },
          { agent: participant("ai", { name: "Ai" }), activity: { kind: "thinking" } },
          { agent: participant("bo", { name: "Bo" }), activity: { kind: "writing" } },
        ]}
      />
    </I18nextProvider>,
  );
  const row = screen.getByRole("list", { name: "Tätige Agenten" });
  expect(row.textContent).toContain("Ed liest ConversationEvents.ts · 1 Werkzeug läuft");
  expect(row.textContent).toContain("Mei testet · 1 Werkzeug läuft");
  expect(row.textContent).toContain("Ai denkt nach …");
  expect(row.textContent).toContain("Bo schreibt …");
});

function renderComposer(answering?: { name: string; onStop: () => void }): {
  readonly onSend: ReturnType<typeof vi.fn>;
} {
  const onSend = vi.fn();
  render(
    <I18nextProvider i18n={de}>
      <ChatPageComposer
        label="Nachricht"
        placeholder="Schreiben"
        onSend={onSend}
        answering={answering}
      />
    </I18nextProvider>,
  );
  return { onSend };
}

async function type(text: string): Promise<HTMLElement> {
  const input = await screen.findByRole("textbox", { name: "Nachricht" });
  // TipTap keeps its editor on the field; jsdom has no text input of its own.
  const editor: unknown = Reflect.get(input, "editor");
  act(() => {
    if (
      typeof editor === "object" &&
      editor !== null &&
      "commands" in editor &&
      typeof editor.commands === "object" &&
      editor.commands !== null &&
      "insertContent" in editor.commands &&
      typeof editor.commands.insertContent === "function"
    )
      editor.commands.insertContent(text);
  });
  return input;
}

it("offers only Senden while nobody answers", async () => {
  renderComposer();
  await screen.findByRole("textbox", { name: "Nachricht" });
  expect(screen.getByRole("button", { name: /Abschicken|Senden/u })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ed umlenken" })).toBeNull();
});

it("steers with Umlenken, sends afterwards with ⌥↵ and stops with Esc while Ed answers", async () => {
  const onStop = vi.fn();
  const { onSend } = renderComposer({ name: "Ed", onStop });
  expect(screen.getByText("Enter lenkt um · ⇧Enter neue Zeile")).toBeTruthy();
  const input = await type("Nimm B");
  await vi.waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Ed umlenken" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Ed umlenken" }));
  expect(onSend).toHaveBeenLastCalledWith("Nimm B", [], "steer");

  await type("Danach C");
  await vi.waitFor(() => expect(input.textContent).toBe("Danach C"));
  fireEvent.keyDown(input, { key: "Enter", altKey: true });
  expect(onSend).toHaveBeenLastCalledWith("Danach C", [], "after");

  fireEvent.keyDown(input, { key: "Escape" });
  expect(onStop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Anhalten" }));
  expect(onStop).toHaveBeenCalledTimes(2);
});
