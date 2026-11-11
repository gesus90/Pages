import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { createI18n } from "@/app/lib/i18n";

import { message, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";
import type { VirtualChatMessage } from "@/definition/VirtualChat";

vi.mock("@/app/components/chat-page/chat-page-voice", () => ({
  ChatPageVoice: ({
    text,
    isOwn,
  }: {
    readonly text: string;
    readonly isOwn: boolean;
  }) => <div data-testid="voice" data-own={String(isOwn)} data-text={text} />,
}));

const i18n = createI18n("en");
const ADA = participant("ada", { name: "Ada", role: "Planner" });
const BOB = participant("bob", { name: "Bob", role: "", color: "#aa3311" });

function answer(
  id: string,
  authorId: string,
  overrides: Partial<VirtualChatMessage> = {},
): VirtualChatMessage {
  return { ...message(id), authorId, ...overrides };
}

function renderHistory(
  props: Partial<ComponentProps<typeof ChatPageHistory>> = {},
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHistory
        messages={[]}
        name="Ada"
        findParticipant={(id) =>
          [ADA, BOB].find((candidate) => candidate.id === id)
        }
        {...props}
      />
    </I18nextProvider>,
  );
}

it("shows the empty hint with the conversation name when nothing was said", () => {
  renderHistory({ name: "Team" });
  expect(screen.getByText("No messages with Team yet.")).toBeTruthy();
  expect(screen.queryByRole("log")).toBeNull();
});

it("shows the log instead of the empty hint while an agent is answering", () => {
  renderHistory({ isAnswering: true });
  expect(screen.getByRole("log", { name: "History with Ada" })).toBeTruthy();
  expect(screen.queryByText(/No messages with/)).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Ada is answering …");
});

it("names the answering participants and falls back to the conversation name", () => {
  const { unmount } = renderHistory({
    isAnswering: true,
    answeringNames: ["Ada", "Bob"],
  });
  expect(screen.getByRole("status").textContent).toBe(
    "Ada, Bob are answering …",
  );
  unmount();
  renderHistory({ isAnswering: true, answeringNames: ["Bob"], name: "Team" });
  expect(screen.getByRole("status").textContent).toBe("Bob is answering …");
});

it("draws own messages as separate right-hand articles in message order", () => {
  renderHistory({ messages: [message("1"), message("2")] });
  const own = screen.getAllByRole("article", { name: "Your message" });
  expect(own.map((article) => article.textContent)).toEqual([
    "text 1",
    "text 2",
  ]);
});

it("draws an own voice message with the player marked as own", () => {
  renderHistory({
    messages: [
      {
        ...message("v"),
        content: "spoken text",
        voice: { url: "/v.wav", durationMs: 1000, transcriptionState: "done" },
      },
    ],
  });
  const voice = screen.getByTestId("voice");
  expect(voice.getAttribute("data-own")).toBe("true");
  expect(voice.getAttribute("data-text")).toBe("spoken text");
});

it("groups consecutive answers of one author under one name line", () => {
  renderHistory({
    messages: [answer("1", "ada"), answer("2", "ada"), answer("3", "bob")],
  });
  const adaBubbles = screen.getAllByRole("article", { name: "Ada" });
  expect(adaBubbles).toHaveLength(2);
  expect(adaBubbles[0]?.textContent).toContain("Planner");
  expect(adaBubbles[0]?.textContent).toContain("text 1");
  expect(adaBubbles[1]?.textContent).toBe("text 2");
  const bob = screen.getByRole("article", { name: "Bob" });
  expect(bob.textContent).toContain("text 3");
  expect(bob.textContent).not.toContain("·");
});

it("splits runs when the author changes and back", () => {
  renderHistory({
    messages: [answer("1", "ada"), message("2"), answer("3", "ada")],
  });
  const adaBubbles = screen.getAllByRole("article", { name: "Ada" });
  expect(adaBubbles).toHaveLength(2);
  expect(adaBubbles[0]?.textContent).toContain("Ada");
  expect(adaBubbles[1]?.textContent).toContain("Ada");
});

it("colors a bubble with the chosen person color", () => {
  renderHistory({ messages: [answer("1", "bob")] });
  const bubble = screen.getByRole("article", { name: "Bob" });
  expect(bubble.className).toContain("border-transparent");
  expect(bubble.style.borderColor).not.toBe("");
});

it("keeps the primary look for an answer without a person color", () => {
  renderHistory({ messages: [answer("1", "ada")] });
  expect(screen.getByRole("article", { name: "Ada" }).className).toContain(
    "bg-primary-subtle",
  );
});

it("shows an author outside the list from what the conversation tells", () => {
  renderHistory({
    messages: [
      answer("1", "stranger", {
        author: { name: "Stranger", kind: "human", color: null },
      }),
    ],
  });
  const bubble = screen.getByRole("article", { name: "Stranger" });
  expect(bubble.textContent).toContain("text 1");
  expect(bubble.textContent).not.toContain("·");
});

it("skips an answer of an unknown author without any description", () => {
  renderHistory({ messages: [answer("1", "ghost"), message("2")] });
  expect(screen.queryByText("text 1")).toBeNull();
  expect(screen.getByText("text 2")).toBeTruthy();
});

it("lists the used tools with and without detail", () => {
  renderHistory({
    messages: [
      answer("1", "ada", {
        toolUses: [
          { name: "list_tickets", detail: "3 open" },
          { name: "read_wiki", detail: "" },
        ],
      }),
    ],
  });
  const tools = within(screen.getByRole("list", { name: "Tools used" }));
  const items = tools.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]!).getByText("list_tickets")).toBeTruthy();
  expect(within(items[0]!).getByText("3 open")).toBeTruthy();
  expect(within(items[1]!).getByText("read_wiki")).toBeTruthy();
  expect(within(items[1]!).getByText("No further details.")).toBeTruthy();
});

it("omits the tool list when an answer used no tool", () => {
  renderHistory({ messages: [answer("1", "ada")] });
  expect(screen.queryByRole("list", { name: "Tools used" })).toBeNull();
});

it("explains with a note in the agent's name why no answer came", () => {
  renderHistory({
    messages: [answer("1", "ada", { notice: "agent_cost_limit" })],
  });
  expect(screen.getByRole("note").textContent).toBe(
    "Ada does not answer: the agent's cost limit is reached.",
  );
});

it("plays an answer voice message as the other side's", () => {
  renderHistory({
    messages: [
      answer("1", "ada", {
        content: "recognized",
        voice: { url: "/v.wav", durationMs: 1000, transcriptionState: "done" },
      }),
    ],
  });
  const voice = screen.getByTestId("voice");
  expect(voice.getAttribute("data-own")).toBe("false");
  expect(voice.getAttribute("data-text")).toBe("recognized");
});

it("offers no older button for a history without older pages", () => {
  renderHistory({ messages: [message("1")] });
  expect(screen.queryByRole("button", { name: /older|Loading/ })).toBeNull();
});

it("loads older messages from the head button", () => {
  const onLoad = vi.fn();
  renderHistory({
    messages: [message("1")],
    older: { hasMore: true, isLoading: false, onLoad },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  expect(onLoad).toHaveBeenCalledTimes(1);
});

it("disables the older button while a page loads", () => {
  renderHistory({
    messages: [message("1")],
    older: { hasMore: true, isLoading: true, onLoad: vi.fn() },
  });
  const button = screen.getByRole("button", { name: "Loading …" });
  expect(button).toHaveProperty("disabled", true);
});

it("scrolls to the newest message when one arrives", () => {
  const scrollHeight = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockReturnValue(480);
  try {
    renderHistory({ messages: [message("1")] });
    expect(screen.getByRole("log").scrollTop).toBe(480);
  } finally {
    scrollHeight.mockRestore();
  }
});

it("never draws images of an own message or an answer", () => {
  const { container } = renderHistory({
    messages: [
      { ...message("1"), content: "mine ![pic](/a.png)" },
      answer("2", "ada", { content: "theirs ![pic](/b.png)" }),
    ],
  });
  expect(screen.getByText(/mine/)).toBeTruthy();
  expect(screen.getByText(/theirs/)).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
});
