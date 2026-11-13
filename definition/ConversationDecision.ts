/**
 * Contracts of the decision of who answers in a group chat (PAGE-317).
 *
 * @remarks
 * A message of a person without an @ in a group chat is judged by the
 * decision model of the instance, or by the observer, as the group
 * chooses. The decision model is one setting of the instance; a group never
 * chooses a model of its own.
 */

import type { AgentModelSelection } from "./AgentModelSelection";
import type { PageAgentModel } from "./PageAgent";

/**
 * Who answers a message of a person without an @ in a group.
 *
 * - `mentions`: only the agents named with @ answer; nobody is chosen.
 * - `observer`: the observer of PAGE-296 chooses on Pica's chat model.
 * - `decision`: the decision model of the instance chooses.
 */
export const CONVERSATION_REPLY_MODES = [
  "mentions",
  "observer",
  "decision",
] as const;

/** One way of {@link CONVERSATION_REPLY_MODES}. */
export type ConversationReplyMode = (typeof CONVERSATION_REPLY_MODES)[number];

/** The mode a group has until its managers choose one: the instance decision model (PAGE-326). */
export const CONVERSATION_DEFAULT_REPLY_MODE: ConversationReplyMode =
  "decision";

/** The most agents that answer one message, by default. */
export const CONVERSATION_DEFAULT_MAXIMUM_RESPONDERS = 1;

/**
 * The range of the most agents that answer one message.
 *
 * @remarks
 * The upper end equals the automatic answers a message may start at all
 * (`CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin`).
 */
export const CONVERSATION_MAXIMUM_RESPONDERS_RANGE = {
  minimum: 1,
  maximum: 3,
} as const;

/**
 * The fixed limits of one decision.
 *
 * @remarks
 * `historyMessages`/`historyCharacters` bound what the model reads of the
 * history, `reasonCharacters` the one sentence it gives,
 * `timeoutSeconds` the longest wait, `agentStreak` how many agent messages
 * in a row, without a person, still start a hand-over.
 */
export const CONVERSATION_DECISION_LIMITS = {
  historyMessages: 8,
  historyCharacters: 6_000,
  reasonCharacters: 300,
  timeoutSeconds: 120,
  agentStreak: 10,
} as const;

/** How a group decides who answers; stored per group. */
export interface ConversationReplySettings {
  readonly conversationId: string;
  readonly mode: ConversationReplyMode;
  /** An agent member that answers when it is unclear who is addressed; `null` for none. */
  readonly defaultResponderId: string | null;
  readonly maximumResponders: number;
}

/** The settings of a group as a member reads them. */
export interface ConversationReplySettingsView extends ConversationReplySettings {
  /** Whether the reading member may change them. */
  readonly canManage: boolean;
  /** The agents among the members, which the default responder is chosen from. */
  readonly agents: readonly ConversationDecisionAgent[];
}

/**
 * What a decision led to.
 *
 * - `responders`: the chosen agents answer.
 * - `default`: the default responder answers and says it was unclear.
 * - `notice`: nobody answers; a hint says that it was unclear.
 * - `nobody`: nobody answers, as nobody was asked.
 */
export type ConversationDecisionOutcome =
  "responders" | "default" | "notice" | "nobody";

/**
 * Why a fallback applied.
 *
 * - `none`: no fallback.
 * - `no_model`: no decision model is chosen or it is unavailable.
 * - `model_failed`: the model failed, timed out or gave an invalid answer.
 * - `unclear`: the model chose nobody but found a question or request.
 */
export type ConversationDecisionFallback =
  "none" | "no_model" | "model_failed" | "unclear";

/** An agent a decision names. */
export interface ConversationDecisionAgent {
  readonly id: string;
  readonly name: string;
}

/** The decision about one message, as the chat shows it. */
export interface ConversationDecisionView {
  readonly messageId: string;
  readonly outcome: ConversationDecisionOutcome;
  readonly fallback: ConversationDecisionFallback;
  /** The agents that answer because of it; empty for `notice` and `nobody`. */
  readonly responders: readonly ConversationDecisionAgent[];
  /** The agents the model thought responsible, which a fallback names. */
  readonly suggested: readonly ConversationDecisionAgent[];
  /** One sentence of the model; empty without a model answer. */
  readonly reason: string;
  /** Whether the model found a question or request; `null` without an answer. */
  readonly needsAnswer: boolean | null;
}

/** The decision model of the instance; `null` while none is chosen. */
export interface ChatDecisionSettings {
  readonly selection: AgentModelSelection | null;
  readonly revision: number;
}

/**
 * Whether decisions can run.
 *
 * - `noModel`: none is chosen.
 * - `modelUnavailable`: the chosen model is not listed any longer.
 * - `ready`: the chosen model is one of the listed models.
 */
export type ChatDecisionStatus = "noModel" | "modelUnavailable" | "ready";

/** The catalog or connection issue the administrator can resolve. */
export type ChatDecisionEmptyReason =
  | "noConnections"
  | "noVisibleConnections"
  | "connectionUnavailable"
  | "emptyCatalog"
  | "noTextModels";

/** What the settings card of the decision model shows. */
export interface ChatDecisionAdministration {
  readonly settings: ChatDecisionSettings;
  readonly status: ChatDecisionStatus;
  readonly models: readonly PageAgentModel[];
  /** Why the choice is empty, with recovery instructions in the card. */
  readonly emptyReason?: ChatDecisionEmptyReason | null;
}
