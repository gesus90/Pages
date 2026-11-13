import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { ChatPageDecision } from "@/app/components/chat-page/chat-page-decision";
import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { createI18n } from "@/app/lib/i18n";

import { message, participant } from "./chat-page-fixture";

import type { ConversationDecisionView } from "@/definition/ConversationDecision";

const i18n = createI18n("en");

const NOBODY: ConversationDecisionView = {
  messageId: "m1",
  outcome: "nobody",
  fallback: "none",
  responders: [],
  answerProbability: 0.06,
  choices: [
    { agentId: null, name: "", probability: 0.91 },
    { agentId: "ed", name: "Ed", probability: 0.05 },
    { agentId: "mei", name: "Mei", probability: 0.04 },
  ],
  model: "perplexity/pplx-decider-v1.3",
};
const RESPONDERS: ConversationDecisionView = {
  messageId: "m2",
  outcome: "responders",
  fallback: "none",
  responders: [{ id: "ed", name: "Ed" }],
  answerProbability: 0.82,
  choices: [
    { agentId: "ed", name: "Ed", probability: 0.78 },
    { agentId: "mei", name: "Mei", probability: 0.15 },
    { agentId: null, name: "", probability: 0.07 },
  ],
  model: "perplexity/pplx-decider-v1.3",
};

function renderDecision(
  decision: ConversationDecisionView,
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatPageDecision decision={decision} />
    </I18nextProvider>,
  );
}

it("shows the quiet line \"no answer · nobody 91 %\" and the probabilities on a click", () => {
  const { container } = renderDecision(NOBODY);
  const summary = screen.getByText("no answer · nobody 91 %");
  expect(summary).toBeTruthy();
  const details = container.querySelector("details");
  expect(details?.open).toBe(false);
  fireEvent.click(summary);
  expect(
    screen.getByText("Answer expected 6 % · nobody 91 %, Ed 5 %, Mei 4 %"),
  ).toBeTruthy();
  expect(
    screen.getByText("Decision model: perplexity/pplx-decider-v1.3"),
  ).toBeTruthy();
});

it("shows only \"no answer\" for a decision without probabilities", () => {
  renderDecision({
    ...NOBODY,
    answerProbability: null,
    choices: [],
    model: null,
  });
  expect(screen.getByText("no answer")).toBeTruthy();
});

it("shows \"Why?\" on an answer the decision model chose, with the probabilities", () => {
  renderDecision(RESPONDERS);
  expect(screen.getByText("Why?")).toBeTruthy();
  expect(
    screen.getByText("Answer expected 82 % · Ed 78 %, Mei 15 %, nobody 7 %"),
  ).toBeTruthy();
});

it("shows nothing for an @ addressing or an unavailable model", () => {
  for (const outcome of ["mention", "unavailable"] as const) {
    const { container, unmount } = renderDecision({
      ...RESPONDERS,
      outcome,
      answerProbability: null,
      choices: [],
    });
    expect(container.textContent).toBe("");
    unmount();
  }
});

const ADA = participant("ada", { name: "Ada", role: "Planner" });

function renderHistory(
  messages: Parameters<typeof ChatPageHistory>[0]["messages"],
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHistory
        messages={messages}
        name="Team"
        findParticipant={(id) => (id === "ada" ? ADA : undefined)}
      />
    </I18nextProvider>,
  );
}

it("shows the line under a message of the person, and \"Why?\" under the answer", () => {
  renderHistory([
    { ...message("1"), decision: NOBODY },
    { ...message("2"), authorId: "ada", decision: RESPONDERS },
  ]);
  expect(screen.getByText("no answer · nobody 91 %")).toBeTruthy();
  expect(screen.getByText("Why?")).toBeTruthy();
});

it("shows no line under a message without a decision", () => {
  renderHistory([message("1"), { ...message("2"), authorId: "ada" }]);
  expect(screen.queryByText(/no answer/)).toBeNull();
  expect(screen.queryByText("Why?")).toBeNull();
});
