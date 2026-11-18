/**
 * Contracts of the control of agents in one chat: the model an
 * agent answers with in a chat, the chat commands `/model`, `/new` and
 * `/compact`, and who may use them.
 * @remarks
 * A chat is the direct chat of a person with an agent or a group. The server
 * checks every right; these contracts only carry what it decided.
 */

import type { AgentChatKind } from "./AgentChatSession";
import type { AgentProviderId } from "./AgentConnection";

/** The endpoint of the control of agents in a chat. */
export const AGENT_CHAT_CONTROL_ENDPOINT = "/chat-page-api/agent-control";

/** The chat commands that steer an agent in a chat; none of them reaches an agent. */
export const AGENT_CHAT_COMMANDS = ["model", "new", "compact"] as const;

/** A chat command that steers an agent. */
export type AgentChatCommandName = (typeof AGENT_CHAT_COMMANDS)[number];

/** The word of `/model reset`, which returns to the agent's own model. */
export const AGENT_CHAT_MODEL_RESET = "reset";

/** The chat whose agent a request steers, as the page names it. */
export interface AgentChatControlTarget {
  readonly kind: AgentChatKind;
  readonly agentId: string;
  /** The group; absent for a direct chat, which is always the viewer's own. */
  readonly conversationId?: string;
}

/** A model and reasoning level an agent answers with. */
export interface AgentChatModelSetting {
  readonly connectionId: string;
  readonly model: string;
  /** `null` follows the default of the model. */
  readonly reasoningEffort: string | null;
}

/** One model the choice of a chat offers. */
export interface AgentChatModelChoice {
  readonly connectionId: string;
  readonly model: string;
  /** The catalog name, such as "Claude Opus 5.5". */
  readonly name: string;
  /** The administrators' name of the connection, such as "Anthropic". */
  readonly connectionName: string;
  readonly provider: AgentProviderId;
  /** The reasoning levels the model offers, from the least effort. */
  readonly reasoningEfforts: readonly string[];
  /** The level the catalog names as the default of the model. */
  readonly defaultReasoningEffort: string | null;
  /** The context size the provider states; `null` when it does not. */
  readonly contextWindow: number | null;
  /** Short names a CLI resolves to the model, such as `opus`. */
  readonly aliases: readonly string[];
  /** Whether the catalog of this connection states a price of zero for exactly this model. */
  readonly isFree?: boolean;
}

/** How the model of an agent in one chat reads. */
export interface AgentChatModelLabel {
  /** The catalog name of the model, or its ID when the catalog lost it. */
  readonly name: string;
  /** The provider of the model's connection, such as `claude_code`; `null` when the connection is gone. */
  readonly provider: AgentProviderId | null;
  /** The model ID of the setting, as the catalog names it; never a connection detail. */
  readonly modelId: string;
  readonly reasoningEffort: string | null;
  /** Whether the chat deviates from the agent's own model. */
  readonly isOverride: boolean;
  /** The context size of the model; `null` when unknown. */
  readonly contextWindow: number | null;
  /**
   * Whether the catalog of the model's connection states a price of zero for
   * exactly this model; absent or `false` shows no "Free" badge. A "Free" in
   * the name is never read as a price.
   */
  readonly isFree?: boolean;
}

/**
 * The model an agent answered with, kept with the stored answer.
 * @remarks
 * Pages records it when the answer is stored, from the catalog of the
 * connection the run used, so the head of the answer reads the same after a
 * reload even when the chat switched to another model since. Answers stored
 * before Pages kept it carry none.
 */
export interface AgentAnswerModel {
  /** The catalog name of the model, or its ID when the catalog names none. */
  readonly name: string;
  /** The provider of the connection the run used; `null` when unknown. */
  readonly provider: AgentProviderId | null;
  readonly modelId: string;
  readonly reasoningEffort: string | null;
  /** Whether the catalog of the used connection stated a price of zero for the model. */
  readonly isFree: boolean;
}

/** What the model choice of an agent in a chat shows. */
export interface AgentChatModelOverview {
  readonly agentId: string;
  readonly agentName: string;
  /** The agent's own model, which applies without a choice of the chat. */
  readonly standard: AgentChatModelSetting & { readonly name: string };
  /** The choice of the chat; `null` follows the agent's own model. */
  readonly override: (AgentChatModelSetting & { readonly name: string }) | null;
  /** The text models of the connections the agent may use. */
  readonly choices: readonly AgentChatModelChoice[];
  /** Whether the viewer may change the model and the session. */
  readonly canControl: boolean;
}

/** Why a request of the control was refused. */
export type AgentChatControlFailure =
  "forbidden" | "notFound" | "invalidInput" | "unavailable" | "modelNotAllowed";

/** A member of a group as the member dialog lists it. */
export interface ChatGroupMemberView {
  readonly id: string;
  readonly name: string;
  readonly kind: "human" | "agent";
  readonly username: string;
  readonly role: string;
  readonly color: string | null;
  readonly avatarImageUrl: string | null;
  /** Whether the member created the group. */
  readonly isOwner: boolean;
  /** Whether the member may steer the agents of the group; always for the owner, never for an agent. */
  readonly canControl: boolean;
  /** The model of an agent in this group, when it deviates from its own. */
  readonly model?: AgentChatModelLabel;
}

/** The members of a group and what the viewer may do with them. */
export interface ChatGroupMembersView {
  readonly groupId: string;
  readonly members: readonly ChatGroupMemberView[];
  /** Whether the viewer created the group, so may add and remove members and dissolve it. */
  readonly canManage: boolean;
}

/** What a chat command answered, for the hint below the input field. */
export type AgentChatCommandOutcome =
  | {
      readonly status: "done";
      readonly command: AgentChatCommandName;
      readonly agentName: string;
    }
  /** A group command without `@Agent`: Pages asks which agent is meant. */
  | {
      readonly status: "chooseAgent";
      readonly command: AgentChatCommandName;
      readonly agents: readonly {
        readonly id: string;
        readonly name: string;
        readonly username: string;
      }[];
    }
  /** `/model` without a model, or a name several models match. */
  | {
      readonly status: "chooseModel";
      readonly overview: AgentChatModelOverview;
      readonly matches: readonly AgentChatModelChoice[];
      readonly query: string;
      /** The `@` name of the agent in a group, which a chosen model repeats; `null` in a direct chat. */
      readonly mention: string | null;
    }
  | { readonly status: "unknownModel"; readonly query: string }
  | {
      readonly status: "unknownEffort";
      readonly effort: string;
      readonly efforts: readonly string[];
    }
  | { readonly status: "unknownAgent"; readonly mention: string }
  | { readonly status: "forbidden" };

/** The answer of the control endpoint. */
export type AgentChatControlResponse =
  | {
      readonly ok: true;
      readonly overview?: AgentChatModelOverview;
      readonly members?: ChatGroupMembersView;
      readonly outcome?: AgentChatCommandOutcome;
    }
  | { readonly ok: false; readonly error: AgentChatControlFailure };

/** A typed chat command, split into its parts. */
export interface ParsedAgentChatCommand {
  readonly command: AgentChatCommandName;
  /** The username after `@`, without it; `null` without one. */
  readonly mention: string | null;
  /** The words after the command and the mention. */
  readonly words: readonly string[];
}

const COMMAND_PATTERN = /^\/(model|new|compact)(?:\s+([\s\S]*))?$/iu;

function isCommandName(value: string): value is AgentChatCommandName {
  return AGENT_CHAT_COMMANDS.some((name) => name === value);
}

/**
 * Recognizes a chat command that steers an agent; any other text is a
 * message.
 * @param text - The text of the input field.
 * @returns The command with its mention and words, or `null`.
 */
export function parseAgentChatCommand(
  text: string,
): ParsedAgentChatCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim());
  const name = match?.[1]?.toLowerCase();
  if (match === null || name === undefined || !isCommandName(name)) return null;
  const words = (match[2] ?? "").split(/\s+/u).filter((word) => word !== "");
  const [first] = words;
  if (first?.startsWith("@") === true && first.length > 1)
    return { command: name, mention: first.slice(1), words: words.slice(1) };
  return { command: name, mention: null, words };
}

/** Lower case without separators, so `Claude-Opus 5.5` and `claudeopus55` match. */
function normalized(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s._\-/:]+/gu, "");
}

function names(choice: AgentChatModelChoice): string[] {
  return [choice.model, choice.name, ...choice.aliases];
}

/**
 * The models a typed name means: an exact ID, name or alias wins, otherwise
 * every model whose ID, name or alias contains the name.
 * @param query - The name the person typed, such as `opus`.
 * @param choices - The models of the choice.
 * @returns One model for a clear name, several for an ambiguous one, none
 * for an unknown one; Pages never guesses between several.
 */
export function matchAgentChatModels(
  query: string,
  choices: readonly AgentChatModelChoice[],
): AgentChatModelChoice[] {
  const needle = normalized(query);
  if (needle === "") return [];
  const exact = choices.filter((choice) =>
    names(choice).some((name) => normalized(name) === needle),
  );
  if (exact.length > 0) return exact;
  return choices.filter((choice) =>
    names(choice).some((name) => normalized(name).includes(needle)),
  );
}

/** The words a person may type for a reasoning level, in German and English. */
const EFFORT_WORDS: Readonly<Record<string, readonly string[]>> = {
  none: ["none", "keine", "aus"],
  minimal: ["minimal"],
  low: ["low", "niedrig", "gering"],
  medium: ["medium", "mittel"],
  high: ["high", "hoch"],
  xhigh: ["xhigh", "sehrhoch", "extrahoch"],
  max: ["max", "maximal", "maximum"],
};

/**
 * The reasoning level a typed word means among the levels of a model.
 * @param word - The typed word, such as `hoch`.
 * @param efforts - The levels the model offers.
 * @returns The level, or `null` when the model offers none the word means.
 */
export function readAgentChatEffort(
  word: string,
  efforts: readonly string[],
): string | null {
  const needle = normalized(word);
  const direct = efforts.find((effort) => normalized(effort) === needle);
  if (direct !== undefined) return direct;
  return (
    efforts.find((effort) =>
      (EFFORT_WORDS[effort] ?? []).some((known) => known === needle),
    ) ?? null
  );
}

/**
 * The short name of a model for the head of a chat, such as "Opus" for
 * "Claude Opus 5.5".
 * @param name - The catalog name of the model.
 */
export function shortModelName(name: string): string {
  const words = name
    .replace(/^(claude|gemini|gpt)[\s-]+/iu, "")
    .split(/\s+/u)
    .filter((word) => word !== "" && !/^\d/u.test(word));
  return words[0] ?? name;
}
