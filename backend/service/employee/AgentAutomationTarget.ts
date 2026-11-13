import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { User } from "@/definition/User";

/** Why the target chat of an automation could not be resolved; its code is the error code of the run. */
export class AutomationTargetError extends Error {
  public readonly code: "target_chat_invalid" | "target_chat_not_found";

  public constructor(code: AutomationTargetError["code"]) {
    super(code);
    this.name = "AutomationTargetError";
    this.code = code;
  }
}

/** The chat an automation of an agent runs in (PAGE-376). */
export type AutomationTarget =
  | {
      /** The direct chat of the owner with the agent. */
      readonly kind: "direct";
      readonly person: User;
    }
  | {
      /** A group the owner and the agent belong to. */
      readonly kind: "group";
      readonly conversationId: string;
      readonly name: string;
      readonly person: User | null;
    }
  | {
      /** An owner who is no person has no direct chat: the run keeps its own session. */
      readonly kind: "own";
    };

const AGENT_NAME = /^@\s*(\S.*)$/u;
const CHAT_NAME = /^\[\[\s*([^\]]+?)\s*\]\]$/u;

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Resolves the target chat of an automation (PAGE-376).
 *
 * @remarks
 * `@Agentname` is the direct chat of the owner of the automation with that
 * agent, which has to be the agent that runs it. `[[Chatname]]` is the group
 * of that name the owner and the agent both belong to; the newest one when
 * several carry the name. Without a target the direct chat of the owner with
 * the agent applies. The automation then runs in the session of that chat.
 */
export class AgentAutomationTarget {
  private readonly store: EmployeeStore;

  public constructor(store: EmployeeStore) {
    this.store = store;
  }

  /**
   * Resolves the chat of one run.
   *
   * @param input - The agent that runs it, the owner of the automation and
   * the target as the automation names it.
   * @throws {AutomationTargetError} `target_chat_invalid` for a target that is
   * neither `@Agentname` nor `[[Chatname]]` or names another agent,
   * `target_chat_not_found` for a group the owner and the agent do not share.
   */
  public async resolve(input: {
    readonly agent: User;
    readonly owner: User | null;
    readonly chat: string | null | undefined;
  }): Promise<AutomationTarget> {
    const text = input.chat?.trim() ?? "";
    const { agent, owner } = input;
    if (text === "") return this.direct(owner);
    const mention = AGENT_NAME.exec(text);
    if (mention?.[1] !== undefined) {
      const name = mention[1].replace(/^@/u, "");
      if (!sameName(name, agent.displayName) && !sameName(name, agent.username))
        throw new AutomationTargetError("target_chat_invalid");
      return this.direct(owner);
    }
    const chat = CHAT_NAME.exec(text);
    if (chat?.[1] === undefined)
      throw new AutomationTargetError("target_chat_invalid");
    const members = [agent.id, ...(owner ? [owner.id] : [])];
    const conversationId = await this.store
      .conversations()
      .findGroupByName(chat[1], members);
    if (conversationId === null)
      throw new AutomationTargetError("target_chat_not_found");
    return { kind: "group", conversationId, name: chat[1], person: owner };
  }

  private direct(owner: User | null): AutomationTarget {
    return owner && owner.isAgent !== true
      ? { kind: "direct", person: owner }
      : { kind: "own" };
  }
}
