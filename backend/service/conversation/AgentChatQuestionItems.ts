import { ConversationError } from "@/backend/error/ConversationError";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_QUESTION_LIMITS } from "@/definition/AgentChatQuestion";

import type {
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionOutcome,
  AgentQuestionRequestItem,
} from "@/definition/AgentChatQuestion";

/**
 * Turns the questions of an agent into the items of its card:
 * stable IDs, the recommended answer first and marked.
 */
export function questionItems(
  requested: readonly AgentQuestionRequestItem[],
): AgentQuestionItem[] {
  return requested.map((item, questionIndex) => {
    const recommended =
      item.recommended >= 0 && item.recommended < item.options.length
        ? item.recommended
        : 0;
    const options = item.options.map((label, index) => ({
      id: `o${index + 1}`,
      label: label.trim(),
      isRecommended: index === recommended,
    }));
    const ordered = [
      ...options.filter((option) => option.isRecommended),
      ...options.filter((option) => !option.isRecommended),
    ];
    return {
      id: `q${questionIndex + 1}`,
      text: item.text.trim(),
      options: ordered,
      isMultipleChoice: item.isMultipleChoice,
    };
  });
}

/**
 * The text of the message that carries the question: what every member,
 * Pica Mobile and the other agents read in the history.
 */
export function questionText(items: readonly AgentQuestionItem[]): string {
  return items
    .map((item) => {
      const options = item.options.map(
        (option) =>
          `- ${option.label}${option.isRecommended ? " (empfohlen)" : ""}`,
      );
      return [`❓ ${item.text}`, ...options].join("\n");
    })
    .join("\n\n");
}

/** Reads the free text of an answer; `null` for none. */
function readFreeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ConversationError("invalid");
  const text = value.trim();
  if (text === "") return null;
  if (Array.from(text).length > AGENT_QUESTION_LIMITS.freeTextCharacters)
    throw new ConversationError("too_long");
  return redactCredentials(text);
}

function readOptionIds(value: unknown, item: AgentQuestionItem): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConversationError("invalid");
  const known = new Set(item.options.map((option) => option.id));
  const chosen = [...new Set(value)];
  if (
    !chosen.every((id): id is string => typeof id === "string" && known.has(id))
  )
    throw new ConversationError("invalid");
  if (!item.isMultipleChoice && chosen.length > 1)
    throw new ConversationError("invalid");
  return chosen;
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ConversationError("invalid");
  return Object.fromEntries(Object.entries(value));
}

/**
 * Reads the untrusted answer of a person to the items of a question.
 *
 * @remarks
 * Every question needs a chosen button or a free text; a single-choice
 * question takes at most one button.
 *
 * @throws {ConversationError} `invalid` for a malformed or incomplete
 * answer, `too_long` for a free text beyond its limit.
 */
export function readQuestionAnswers(
  input: unknown,
  items: readonly AgentQuestionItem[],
): AgentQuestionAnswer[] {
  if (!Array.isArray(input)) throw new ConversationError("invalid");
  const byId = new Map(
    input.map((entry) => {
      const fields = fieldsOf(entry);
      return [fields.questionId, fields] as const;
    }),
  );
  return items.map((item) => {
    const fields = byId.get(item.id);
    if (!fields) throw new ConversationError("invalid");
    const optionIds = readOptionIds(fields.optionIds, item);
    const freeText = readFreeText(fields.freeText);
    if (optionIds.length === 0 && freeText === null)
      throw new ConversationError("invalid");
    return { questionId: item.id, optionIds, freeText };
  });
}

/** What the agent learns of the answer: the question texts and the chosen labels. */
export function answeredOutcome(
  question: {
    readonly id: string;
    readonly items: readonly AgentQuestionItem[];
  },
  answer: {
    readonly answers: readonly AgentQuestionAnswer[];
    readonly answeredBy: string;
  },
): AgentQuestionOutcome {
  return {
    status: "answered",
    questionId: question.id,
    answeredBy: answer.answeredBy,
    answers: question.items.map((item) => {
      const entry = answer.answers.find(
        (candidate) => candidate.questionId === item.id,
      );
      const chosen = item.options.filter((option) =>
        entry?.optionIds.includes(option.id),
      );
      return {
        question: item.text,
        chosen: chosen.map((option) => option.label),
        freeText: entry?.freeText ?? null,
        isRecommendedChosen: chosen.some((option) => option.isRecommended),
      };
    }),
  };
}
