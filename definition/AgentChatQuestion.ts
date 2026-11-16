/**
 * Contracts of the interim messages and questions of chat agents.
 * @remarks
 * During a round an agent may write a short interim message to its chat
 * (`nachricht_senden`) without ending the round, and ask the people of the
 * chat 1 to 3 questions with 2 to 4 answers each (`rueckfrage`). The round
 * waits for the answer up to a time limit; the answer goes straight back to
 * the agent. Both are stored as messages of the agent in the conversation of
 * the chat, so every member and every other agent sees them in the history;
 * only people answer a question.
 */

/** Prefix of the `clientMessageId` of an interim message of an agent. */
export const CONVERSATION_AGENT_INTERIM_PREFIX = "agent-interim-";

/** Prefix of the `clientMessageId` of the message that carries a question of an agent. */
export const CONVERSATION_AGENT_QUESTION_PREFIX = "agent-question-";

/** The bounds of one question request. */
export const AGENT_QUESTION_LIMITS = {
  questions: { minimum: 1, maximum: 3 },
  options: { minimum: 2, maximum: 4 },
  questionCharacters: 500,
  optionCharacters: 120,
  freeTextCharacters: 2_000,
  interimCharacters: 4_000,
} as const;

/** How long a question waits for its answer while the agent names no limit, in minutes. */
export const AGENT_QUESTION_TIMEOUT_DEFAULT_MINUTES = 15;

/** The range of the time limit of a question, in minutes. */
export const AGENT_QUESTION_TIMEOUT_RANGE_MINUTES = {
  minimum: 1,
  maximum: 60,
} as const;

/** Where a question stands: open, answered, without answer in time, or ended with its round. */
export type AgentQuestionStatus = "open" | "answered" | "expired" | "cancelled";

/** One answer button of a question. */
export interface AgentQuestionOption {
  readonly id: string;
  readonly label: string;
  /** The answer the agent recommends; it stands first and is highlighted. */
  readonly isRecommended: boolean;
}

/** One question of a request. */
export interface AgentQuestionItem {
  readonly id: string;
  readonly text: string;
  readonly options: readonly AgentQuestionOption[];
  /** Whether several answers may be chosen. */
  readonly isMultipleChoice: boolean;
}

/** The consequential step a question confirms. */
export interface AgentQuestionConfirmation {
  /** The tool or Pages operation held back for the approval. */
  readonly tool: string;
  /** Its exact parameters, as the held-back call named them. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** The answer to one question: the chosen buttons and the free text. */
export interface AgentQuestionAnswer {
  readonly questionId: string;
  readonly optionIds: readonly string[];
  /** The free answer; `null` without one. */
  readonly freeText: string | null;
}

/** Who answered a question, as the card names them. */
export interface AgentQuestionResponder {
  readonly id: string;
  readonly name: string;
}

/** A question as the chat page shows it on its card. */
export interface AgentQuestionView {
  readonly id: string;
  readonly status: AgentQuestionStatus;
  readonly items: readonly AgentQuestionItem[];
  /** The step the question confirms; only its name, never its parameters. */
  readonly confirmsTool: string | null;
  readonly answers: readonly AgentQuestionAnswer[];
  readonly answeredBy: AgentQuestionResponder | null;
  /** ISO 8601 moment of the answer; `null` while none exists. */
  readonly answeredAt: string | null;
  /** ISO 8601 moment the question stops waiting. */
  readonly expiresAt: string;
  /** Whether the signed-in person may answer it now. */
  readonly canAnswer: boolean;
}

/** One question as the agent asks it. */
export interface AgentQuestionRequestItem {
  readonly text: string;
  readonly options: readonly string[];
  /** The index of the recommended answer; the first one without it. */
  readonly recommended: number;
  readonly isMultipleChoice: boolean;
}

/** What the agent asks. */
export interface AgentQuestionRequest {
  readonly items: readonly AgentQuestionRequestItem[];
  readonly timeoutMinutes: number;
  readonly confirmation: AgentQuestionConfirmation | null;
}

/** What the agent learns of its question. */
export type AgentQuestionOutcome =
  | {
      readonly status: "answered";
      readonly questionId: string;
      readonly answeredBy: string;
      readonly answers: readonly {
        readonly question: string;
        readonly chosen: readonly string[];
        readonly freeText: string | null;
        /** Whether the recommended answer was chosen. */
        readonly isRecommendedChosen: boolean;
      }[];
    }
  | {
      readonly status: "expired" | "cancelled";
      readonly questionId: string;
    };

/** The interim messages and questions of one job, bound to its chat. */
export interface AgentChatInteractions {
  /** Writes an interim message of the agent to its chat. */
  say(text: string): Promise<{ readonly messageId: string }>;
  /** Asks a question and waits for its answer, the time limit or the end of the round. */
  ask(
    request: AgentQuestionRequest,
    signal: AbortSignal,
  ): Promise<AgentQuestionOutcome>;
}
