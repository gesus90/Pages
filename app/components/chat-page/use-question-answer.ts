import { useState } from "react";
import { useFetcher } from "react-router";

import type {
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionView,
} from "@/definition/AgentChatQuestion";

/** The chosen buttons and the free text of one question while the person answers. */
interface DraftAnswer {
  readonly optionIds: readonly string[];
  readonly freeText: string;
}

/** What the card of a question needs to answer it (PAGE-391). */
export interface QuestionAnswering {
  readonly draft: (questionId: string) => DraftAnswer;
  /** Chooses a button: toggles it for multiple choice, replaces the choice otherwise. */
  readonly choose: (item: AgentQuestionItem, optionId: string) => void;
  readonly setFreeText: (questionId: string, text: string) => void;
  /** Whether every question has a button or a free text. */
  readonly isComplete: boolean;
  readonly isSending: boolean;
  readonly send: () => void;
  /**
   * Answers a single question of one choice at once with one button; other
   * questions keep their draft.
   */
  readonly sendChoice: (item: AgentQuestionItem, optionId: string) => void;
}

const EMPTY_DRAFT: DraftAnswer = { optionIds: [], freeText: "" };

function isAnswered(draft: DraftAnswer): boolean {
  return draft.optionIds.length > 0 || draft.freeText.trim() !== "";
}

function toAnswers(
  question: AgentQuestionView,
  drafts: Readonly<Record<string, DraftAnswer>>,
): AgentQuestionAnswer[] {
  return question.items.map((item) => {
    const draft = drafts[item.id] ?? EMPTY_DRAFT;
    const freeText = draft.freeText.trim();
    return {
      questionId: item.id,
      optionIds: draft.optionIds,
      freeText: freeText === "" ? null : freeText,
    };
  });
}

/**
 * The answer of a person to the question of an agent: the chosen buttons and
 * free texts, sent with the intent `answer-question` of the chat page.
 */
export function useQuestionAnswer(
  question: AgentQuestionView,
): QuestionAnswering {
  const fetcher = useFetcher();
  const [drafts, setDrafts] = useState<Readonly<Record<string, DraftAnswer>>>(
    {},
  );
  const draft = (questionId: string): DraftAnswer =>
    drafts[questionId] ?? EMPTY_DRAFT;
  const update = (questionId: string, change: Partial<DraftAnswer>): void => {
    setDrafts((current) => ({
      ...current,
      [questionId]: { ...(current[questionId] ?? EMPTY_DRAFT), ...change },
    }));
  };
  const submit = (next: Readonly<Record<string, DraftAnswer>>): void => {
    const formData = new FormData();
    formData.set("intent", "answer-question");
    formData.set("questionId", question.id);
    formData.set("answers", JSON.stringify(toAnswers(question, next)));
    void fetcher.submit(formData, { method: "post" });
  };
  const choose = (item: AgentQuestionItem, optionId: string): void => {
    const chosen = draft(item.id).optionIds;
    if (!item.isMultipleChoice) {
      update(item.id, { optionIds: [optionId] });
      return;
    }
    update(item.id, {
      optionIds: chosen.includes(optionId)
        ? chosen.filter((id) => id !== optionId)
        : [...chosen, optionId],
    });
  };
  return {
    draft,
    choose,
    setFreeText: (questionId, text) => update(questionId, { freeText: text }),
    isComplete: question.items.every((item) => isAnswered(draft(item.id))),
    isSending: fetcher.state !== "idle",
    send: () => submit(drafts),
    sendChoice: (item, optionId) => {
      const next = { ...drafts, [item.id]: { ...draft(item.id), optionIds: [optionId] } };
      setDrafts(next);
      submit(next);
    },
  };
}
