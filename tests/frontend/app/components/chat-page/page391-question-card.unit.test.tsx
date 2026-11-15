import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { ChatPageQuestionCard } from "@/app/components/chat-page/chat-page-question-card";
import { createI18n } from "@/app/lib/i18n";

import { participant } from "./chat-page-fixture";

import type * as ReactRouter from "react-router";

import type { AgentQuestionView } from "@/definition/AgentChatQuestion";

const fetcher = vi.hoisted(() => ({
  state: "idle",
  submit: vi.fn<(form: FormData, options: { method: string }) => void>(),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof ReactRouter>()),
  useFetcher: () => fetcher,
}));

const i18n = createI18n("en");
const ADA = participant("ada", { name: "Ada" });

beforeEach(() => {
  fetcher.submit.mockReset();
});

const OPEN: AgentQuestionView = {
  id: "question-1",
  status: "open",
  items: [
    {
      id: "q1",
      text: "Delete ticket PAGE-12?",
      options: [
        { id: "o1", label: "Delete", isRecommended: true },
        { id: "o2", label: "Cancel", isRecommended: false },
      ],
      isMultipleChoice: false,
    },
  ],
  confirmsTool: "ticket.delete",
  answers: [],
  answeredBy: null,
  answeredAt: null,
  expiresAt: "2026-11-15T12:15:00.000Z",
  canAnswer: true,
};

function renderCard(question: AgentQuestionView): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatPageQuestionCard question={question} />
    </I18nextProvider>,
  );
}

function submitted(): FormData {
  const call = fetcher.submit.mock.calls[0];
  if (!call) throw new Error("nothing was submitted");
  return call[0];
}

it("shows the question with the recommended answer first in the accent color and answers with one click", () => {
  renderCard(OPEN);
  expect(screen.getByRole("region", { name: "Confirmation" })).toBeTruthy();
  expect(screen.getByText("ticket.delete")).toBeTruthy();
  const buttons = screen
    .getByRole("group", { name: "Delete ticket PAGE-12?" })
    .querySelectorAll("button");
  expect(buttons[0]?.textContent).toContain("Delete");
  expect(buttons[0]?.className).toContain("bg-primary");
  expect(buttons[1]?.className).not.toContain("bg-primary");
  expect(screen.getByRole("textbox", { name: "Free answer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Delete/u }));
  const form = submitted();
  expect(form.get("intent")).toBe("answer-question");
  expect(form.get("questionId")).toBe("question-1");
  expect(JSON.parse(String(form.get("answers")))).toEqual([
    { questionId: "q1", optionIds: ["o1"], freeText: null },
  ]);
});

it("sends a free answer with the send button", () => {
  renderCard({ ...OPEN, confirmsTool: null });
  expect(screen.getByRole("region", { name: "Question" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Free answer" }), {
    target: { value: "Only tomorrow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  expect(JSON.parse(String(submitted().get("answers")))).toEqual([
    { questionId: "q1", optionIds: [], freeText: "Only tomorrow" },
  ]);
});

it("collects several answers of a multiple-choice question before sending", () => {
  renderCard({
    ...OPEN,
    confirmsTool: null,
    items: [
      {
        id: "q1",
        text: "Delete ticket PAGE-12?",
        options: [
          { id: "o1", label: "Delete", isRecommended: true },
          { id: "o2", label: "Cancel", isRecommended: false },
        ],
        isMultipleChoice: true,
      },
    ],
  });
  expect(screen.getByText("Several answers possible")).toBeTruthy();
  const send = screen.getByRole("button", { name: "Send answer" });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: /Delete/u }));
  fireEvent.click(screen.getByRole("button", { name: /Cancel/u }));
  expect(fetcher.submit).not.toHaveBeenCalled();
  fireEvent.click(send);
  expect(JSON.parse(String(submitted().get("answers")))).toEqual([
    { questionId: "q1", optionIds: ["o1", "o2"], freeText: null },
  ]);
});

it("locks the card after the answer and shows who chose what", () => {
  renderCard({
    ...OPEN,
    status: "answered",
    canAnswer: false,
    answers: [{ questionId: "q1", optionIds: ["o2"], freeText: "Not yet" }],
    answeredBy: { id: "igor", name: "Igor" },
  });
  expect(screen.getByText("Answered by Igor")).toBeTruthy();
  expect(screen.getByText("Free answer: Not yet")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  const cancel = screen.getByRole("button", { name: /Cancel/u });
  expect(cancel.getAttribute("aria-pressed")).toBe("true");
  expect(cancel).toHaveProperty("disabled", true);
  fireEvent.click(cancel);
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("says that the agent continues on its own after the time limit", () => {
  renderCard({ ...OPEN, status: "expired", canAnswer: false });
  expect(
    screen.getByText(
      "No answer within the time limit – the agent continues at its own discretion.",
    ),
  ).toBeTruthy();
});

it("keeps the buttons for the person asked and shows them disabled to everybody else", () => {
  renderCard({ ...OPEN, canAnswer: false });
  expect(screen.getByText("Only the person asked can answer.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Delete/u })).toHaveProperty(
    "disabled",
    true,
  );
});

it("shows an interim message quieter and a question as its card in the history", () => {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHistory
        messages={[
          {
            id: "m1",
            authorId: "ada",
            content: "On it, tests running …",
            toolUses: [],
            isInterim: true,
          },
          {
            id: "m2",
            authorId: "ada",
            content: "❓ Delete ticket PAGE-12?",
            toolUses: [],
            question: OPEN,
          },
          { id: "m3", authorId: "ada", content: "Done.", toolUses: [] },
        ]}
        name="Ada"
        findParticipant={(id) => (id === "ada" ? ADA : undefined)}
      />
    </I18nextProvider>,
  );
  const interim = container.querySelector('[data-interim="true"]');
  expect(interim?.textContent).toContain("On it, tests running …");
  expect(interim?.textContent).toContain("Interim message");
  expect(container.querySelectorAll('[data-interim="true"]')).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Confirmation" })).toBeTruthy();
  expect(screen.queryByText("❓ Delete ticket PAGE-12?")).toBeNull();
  expect(screen.getByText("Done.")).toBeTruthy();
});
