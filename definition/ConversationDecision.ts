/**
 * Contracts of the decision of who answers in a group chat (PAGE-317,
 * PAGE-379).
 *
 * @remarks
 * Agents answer a message of a group when it names them with `@Name`. A
 * message of a person without an @ is judged by the decision model of the
 * instance, an OpenRouter decision model that gives probabilities; Pages
 * decides with thresholds, never the model. The decision model is one setting
 * of the instance; a group never chooses a model of its own.
 */

import type { AgentModelSelection } from "./AgentModelSelection";
import type { AgentCatalogModel } from "./AgentModelCatalog";
import type { PageAgentModel } from "./PageAgent";

/**
 * Who answers a message of a person without an @ in a group.
 *
 * - `mentions`: only the agents named with @ answer; nobody else is chosen.
 * - `decision`: like `mentions`, and the decision model of the instance
 *   decides who is meant when a message names nobody with @.
 */
export const CONVERSATION_REPLY_MODES = ["mentions", "decision"] as const;

/** One way of {@link CONVERSATION_REPLY_MODES}. */
export type ConversationReplyMode = (typeof CONVERSATION_REPLY_MODES)[number];

/** The mode a group has until its managers choose one. */
export const CONVERSATION_DEFAULT_REPLY_MODE: ConversationReplyMode =
  "decision";

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

/** The range of a threshold, in whole percent. */
export const CONVERSATION_THRESHOLD_RANGE = {
  minimum: 0,
  maximum: 100,
} as const;

/**
 * What Pages decides with after the decision model gave its probabilities.
 *
 * @remarks
 * The thresholds are whole percent. Nobody answers when the chance that an
 * answer is expected stays below `answerThreshold` or nobody is the most
 * probable choice. The most probable agent answers from
 * `responsibilityThreshold` on; each further agent answers from
 * `secondThreshold` on while fewer than `maximumResponders` answer.
 */
export interface ConversationDecisionRules {
  readonly answerThreshold: number;
  readonly responsibilityThreshold: number;
  readonly secondThreshold: number;
  readonly maximumResponders: number;
}

/** The rules of an instance that nobody changed: 60 %, 50 %, 40 % and two answering agents. */
export const CONVERSATION_DEFAULT_DECISION_RULES: ConversationDecisionRules = {
  answerThreshold: 60,
  responsibilityThreshold: 50,
  secondThreshold: 40,
  maximumResponders: 2,
};

/** The values a group sets itself; `null` follows the default of the instance. */
export type ConversationDecisionRuleOverrides = {
  readonly [Rule in keyof ConversationDecisionRules]: number | null;
};

/** A group without values of its own. */
export const CONVERSATION_NO_RULE_OVERRIDES: ConversationDecisionRuleOverrides =
  {
    answerThreshold: null,
    responsibilityThreshold: null,
    secondThreshold: null,
    maximumResponders: null,
  };

/**
 * The fixed limits of one decision.
 *
 * @remarks
 * `historyMessages`/`historyCharacters` bound what the model reads of the
 * history, `specializationCharacters` what it reads of one agent's `AGENT.md`,
 * `timeoutSeconds` the longest wait, `agentStreak` how many agent messages in
 * a row, without a person, still start a hand-over, `listedDecisions` how
 * many decisions the popup lists.
 */
export const CONVERSATION_DECISION_LIMITS = {
  historyMessages: 8,
  historyCharacters: 6_000,
  specializationCharacters: 400,
  timeoutSeconds: 30,
  agentStreak: 10,
  listedDecisions: 30,
} as const;

/**
 * The rules that apply to a group: its own value where it set one, the default
 * of the instance otherwise.
 *
 * @param defaults - The defaults of the instance.
 * @param overrides - The values the group set itself.
 * @returns The rules that apply to the group.
 */
export function resolveDecisionRules(
  defaults: ConversationDecisionRules,
  overrides: ConversationDecisionRuleOverrides,
): ConversationDecisionRules {
  return {
    answerThreshold: overrides.answerThreshold ?? defaults.answerThreshold,
    responsibilityThreshold:
      overrides.responsibilityThreshold ?? defaults.responsibilityThreshold,
    secondThreshold: overrides.secondThreshold ?? defaults.secondThreshold,
    maximumResponders:
      overrides.maximumResponders ?? defaults.maximumResponders,
  };
}

/**
 * Whether a number is a valid set of rules: whole percents and a count of
 * answering agents in range.
 *
 * @param rules - The submitted or stored rules.
 */
export function isValidDecisionRules(rules: ConversationDecisionRules): boolean {
  const { minimum, maximum } = CONVERSATION_THRESHOLD_RANGE;
  const isPercent = (value: number): boolean =>
    Number.isInteger(value) && value >= minimum && value <= maximum;
  return (
    isPercent(rules.answerThreshold) &&
    isPercent(rules.responsibilityThreshold) &&
    isPercent(rules.secondThreshold) &&
    Number.isInteger(rules.maximumResponders) &&
    rules.maximumResponders >=
      CONVERSATION_MAXIMUM_RESPONDERS_RANGE.minimum &&
    rules.maximumResponders <= CONVERSATION_MAXIMUM_RESPONDERS_RANGE.maximum
  );
}

/**
 * A probability in whole percent, as the chat shows it.
 *
 * @param probability - A probability from 0 to 1.
 */
export function probabilityPercent(probability: number): number {
  return Math.round(probability * 100);
}

/**
 * Whether a catalog model is a decision model (PAGE-379).
 *
 * @param model - The modalities its catalog states.
 * @returns `true` only when the catalog states `decisions` among the outputs.
 *
 * @remarks
 * OpenRouter lists these models only under `output_modalities=decisions` and
 * runs them through `POST /api/alpha/decisions`
 * (https://openrouter.ai/docs/guides/community/multimodal-decisions). A model
 * whose catalog states no modalities never counts as one.
 */
export function isDecisionModel(
  model: Pick<AgentCatalogModel, "outputModalities">,
): boolean {
  return model.outputModalities?.includes("decisions") === true;
}

/** How a group decides who answers; stored per group. */
export interface ConversationReplySettings {
  readonly conversationId: string;
  readonly mode: ConversationReplyMode;
  /** The values the group set itself; the rest follows the instance. */
  readonly overrides: ConversationDecisionRuleOverrides;
}

/**
 * Why decisions cannot run now, which the managers of a group read.
 *
 * - `noModel`: no decision model is chosen.
 * - `modelUnavailable`: the chosen model is not listed any longer.
 * - `modelFailed`: the last call of the model failed or gave no valid answer.
 */
export type ConversationDecisionHint =
  "noModel" | "modelUnavailable" | "modelFailed";

/** The decision model of the instance as a group's popup names it. */
export interface ConversationDecisionModelView {
  readonly status: ChatDecisionStatus;
  /** The name of the chosen model; `null` while none is chosen. */
  readonly name: string | null;
}

/** The settings of a group as a member reads them. */
export interface ConversationReplySettingsView {
  readonly conversationId: string;
  readonly mode: ConversationReplyMode;
  /** The rules that apply: the group's own values and the defaults for the rest. */
  readonly rules: ConversationDecisionRules;
  /** The defaults of the instance, which the group follows without values of its own. */
  readonly defaults: ConversationDecisionRules;
  /** Whether the group sets no value itself. */
  readonly isDefault: boolean;
  /** Whether the reading member may change them. */
  readonly canManage: boolean;
  /** The decision model of the instance. */
  readonly decisionModel: ConversationDecisionModelView;
  /** Why decisions cannot run; only a manager gets it. */
  readonly hint: ConversationDecisionHint | null;
}

/**
 * What a decision led to.
 *
 * - `responders`: the chosen agents answer.
 * - `nobody`: nobody answers, as the model or the thresholds chose nobody.
 * - `mention`: the person named agents with @; the model was not asked.
 * - `unavailable`: no usable model, so the group behaved like `mentions`.
 */
export type ConversationDecisionOutcome =
  "responders" | "nobody" | "mention" | "unavailable";

/**
 * Why the model was not used.
 *
 * - `none`: it was used, or not needed.
 * - `no_model`: no decision model is chosen or it is unavailable.
 * - `model_failed`: the model failed, timed out or gave an invalid answer.
 */
export type ConversationDecisionFallback = "none" | "no_model" | "model_failed";

/** An agent a decision names. */
export interface ConversationDecisionAgent {
  readonly id: string;
  readonly name: string;
}

/** One option of the question "Which agent is meant?" with its probability. */
export interface ConversationDecisionChoice {
  /** The agent; `null` for the option "nobody". */
  readonly agentId: string | null;
  readonly name: string;
  /** From 0 to 1. */
  readonly probability: number;
}

/** The decision about one message, as the chat shows it. */
export interface ConversationDecisionView {
  readonly messageId: string;
  readonly outcome: ConversationDecisionOutcome;
  readonly fallback: ConversationDecisionFallback;
  /** The agents that answer because of it; empty unless `responders` or `mention`. */
  readonly responders: readonly ConversationDecisionAgent[];
  /** The chance that the message expects an answer of an agent, 0 to 1; `null` without a model answer. */
  readonly answerProbability: number | null;
  /** The options of the second question, the most probable first; empty without a model answer. */
  readonly choices: readonly ConversationDecisionChoice[];
  /** The decision model that answered; `null` when none was asked. */
  readonly model: string | null;
}

/** One decision of the list in the popup of a group. */
export interface ConversationDecisionEntry extends ConversationDecisionView {
  /** The text of the message, shortened. */
  readonly text: string;
  readonly createdAt: string;
}

/** The decision model and the default rules of the instance; the model is `null` while none is chosen. */
export interface ChatDecisionSettings {
  readonly selection: AgentModelSelection | null;
  readonly rules: ConversationDecisionRules;
  readonly revision: number;
}

/**
 * Whether decisions can run.
 *
 * - `noModel`: none is chosen.
 * - `modelUnavailable`: the chosen model is not listed any longer.
 * - `ready`: the chosen model is one of the listed decision models.
 */
export type ChatDecisionStatus = "noModel" | "modelUnavailable" | "ready";

/** What the settings card of the decision model shows. */
export interface ChatDecisionAdministration {
  readonly settings: ChatDecisionSettings;
  readonly status: ChatDecisionStatus;
  readonly models: readonly PageAgentModel[];
}
