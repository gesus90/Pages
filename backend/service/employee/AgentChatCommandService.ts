import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  AGENT_CHAT_MODEL_RESET,
  matchAgentChatModels,
  parseAgentChatCommand,
  readAgentChatEffort,
} from "@/definition/AgentChatControl";

import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AgentChatCommandName,
  AgentChatCommandOutcome,
  AgentChatControlTarget,
  AgentChatModelChoice,
  ParsedAgentChatCommand,
} from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";
import type { AgentChatAccess } from "./AgentChatAccess";
import type { AgentChatControlService } from "./AgentChatControlService";

/** The chat a command was typed in. */
export type AgentChatCommandChat =
  | { readonly kind: "direct"; readonly agentId: string }
  | { readonly kind: "group"; readonly conversationId: string };

/** What the chat commands run on. */
export interface AgentChatCommandDependencies {
  readonly users: Pick<UserRepository, "findById">;
  readonly access: Pick<AgentChatAccess, "groupMembers">;
  readonly control: Pick<
    AgentChatControlService,
    "overview" | "setModel" | "renew" | "compact"
  >;
}

/** The model and the reasoning level a `/model` command names. */
type ModelPick =
  | {
      readonly status: "picked";
      readonly choice: AgentChatModelChoice;
      readonly effort: string | null;
    }
  | {
      readonly status: "ambiguous";
      readonly matches: readonly AgentChatModelChoice[];
      readonly query: string;
    }
  | Extract<
      AgentChatCommandOutcome,
      { readonly status: "unknownModel" | "unknownEffort" }
    >;

function sameName(first: string, second: string): boolean {
  return first.toLocaleLowerCase() === second.toLocaleLowerCase();
}

/**
 * The chat commands `/model`, `/new` and `/compact` of a person (PAGE-380).
 *
 * @remarks
 * A command never reaches an agent: it is no message, so it asks for no
 * answer and no decision. Only a person runs one; the rights are those of the
 * menu of the agent. In a group a command names its agent with `@`, and Pages
 * asks which agent is meant instead of steering all. A model name may be
 * short, such as `opus`; a name several models match lists them instead of
 * guessing.
 */
export class AgentChatCommandService {
  private readonly dependencies: AgentChatCommandDependencies;

  public constructor(dependencies: AgentChatCommandDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs a typed command.
   *
   * @throws {AgentEmployeeError} `invalidInput` for a text that is no
   * command, `notFound` for a chat the person does not take part in.
   */
  public async run(
    person: User,
    chat: AgentChatCommandChat,
    text: string,
  ): Promise<AgentChatCommandOutcome> {
    const parsed = parseAgentChatCommand(text);
    if (parsed === null) throw new AgentEmployeeError("invalidInput");
    // An agent never steers an agent, whatever its message says.
    if (person.isAgent === true) return { status: "forbidden" };
    const resolved = await this.resolveTarget(person, chat, parsed);
    if ("status" in resolved) return resolved;
    try {
      return await this.execute(person, parsed, resolved);
    } catch (error: unknown) {
      if (error instanceof AgentEmployeeError && error.code === "forbidden")
        return { status: "forbidden" };
      throw error;
    }
  }

  private async execute(
    person: User,
    parsed: ParsedAgentChatCommand,
    target: AgentChatControlTarget,
  ): Promise<AgentChatCommandOutcome> {
    const { control } = this.dependencies;
    if (parsed.command === "new") {
      const scope = await control.renew(person, target);
      return this.done("new", scope.agent.displayName);
    }
    if (parsed.command === "compact") {
      const scope = await control.compact(person, target);
      return this.done("compact", scope.agent.displayName);
    }
    return this.model(person, parsed, target);
  }

  private async model(
    person: User,
    parsed: ParsedAgentChatCommand,
    target: AgentChatControlTarget,
  ): Promise<AgentChatCommandOutcome> {
    const { control } = this.dependencies;
    const { words } = parsed;
    const mention = target.kind === "group" ? parsed.mention : null;
    const overview = await control.overview(person, target);
    const [first] = words;
    if (first === undefined)
      return {
        status: "chooseModel",
        overview,
        matches: overview.choices,
        query: "",
        mention,
      };
    if (words.length === 1 && sameName(first, AGENT_CHAT_MODEL_RESET)) {
      await control.setModel(person, target, null);
      return this.done("model", overview.agentName);
    }
    const pick = this.pickModel(words, overview.choices);
    if (pick.status === "ambiguous")
      return {
        status: "chooseModel",
        overview,
        matches: pick.matches,
        query: pick.query,
        mention,
      };
    if (pick.status !== "picked") return pick;
    await control.setModel(person, target, {
      connectionId: pick.choice.connectionId,
      model: pick.choice.model,
      reasoningEffort: pick.effort,
    });
    return this.done("model", overview.agentName);
  }

  /** The model all words name, or the model the words before a last level word name. */
  private pickModel(
    words: readonly string[],
    choices: readonly AgentChatModelChoice[],
  ): ModelPick {
    const query = words.join(" ");
    let candidates = matchAgentChatModels(query, choices);
    let effortWord: string | null = null;
    if (candidates.length === 0 && words.length > 1) {
      candidates = matchAgentChatModels(words.slice(0, -1).join(" "), choices);
      effortWord = words.at(-1) ?? null;
    }
    const [choice] = candidates;
    if (choice === undefined) return { status: "unknownModel", query };
    if (candidates.length > 1)
      return { status: "ambiguous", matches: candidates, query };
    if (effortWord === null) return { status: "picked", choice, effort: null };
    const effort = readAgentChatEffort(effortWord, choice.reasoningEfforts);
    if (effort === null)
      return {
        status: "unknownEffort",
        effort: effortWord,
        efforts: choice.reasoningEfforts,
      };
    return { status: "picked", choice, effort };
  }

  /** The agent a command steers: the agent of a direct chat, or the one named with `@` in a group. */
  private async resolveTarget(
    person: User,
    chat: AgentChatCommandChat,
    parsed: ParsedAgentChatCommand,
  ): Promise<AgentChatControlTarget | AgentChatCommandOutcome> {
    if (chat.kind === "direct")
      return { kind: "direct", agentId: chat.agentId };
    const agents = await this.groupAgents(person, chat.conversationId);
    if (parsed.mention === null)
      return {
        status: "chooseAgent",
        command: parsed.command,
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.displayName,
          username: agent.username,
        })),
      };
    const mention = parsed.mention;
    const agent = agents.find(
      (candidate) =>
        sameName(candidate.username, mention) ||
        sameName(candidate.displayName, mention),
    );
    if (!agent) return { status: "unknownAgent", mention };
    return {
      kind: "group",
      agentId: agent.id,
      conversationId: chat.conversationId,
    };
  }

  private async groupAgents(
    person: User,
    conversationId: string,
  ): Promise<User[]> {
    const memberIds = await this.dependencies.access.groupMembers(
      person,
      conversationId,
    );
    const members = await Promise.all(
      memberIds.map((id) => this.dependencies.users.findById(id)),
    );
    return members.filter((member): member is User => member?.isAgent === true);
  }

  private done(
    command: AgentChatCommandName,
    agentName: string,
  ): AgentChatCommandOutcome {
    return { status: "done", command, agentName };
  }
}
