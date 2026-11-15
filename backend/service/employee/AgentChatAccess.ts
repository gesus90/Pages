import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AgentChatKind } from "@/definition/AgentChatSession";
import type { AgentChatControlTarget } from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

/** What the access to an agent in a chat is decided from. */
export interface AgentChatAccessDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly conversations: Pick<
    ConversationRepository,
    "findForMember" | "createdBy" | "memberIds"
  >;
}

/** An agent in a chat the viewer takes part in, with what the viewer may do. */
export interface AgentChatScope {
  readonly agent: User;
  readonly employee: StoredAgentEmployee;
  readonly kind: AgentChatKind;
  /** The person of a direct chat (the viewer) or the conversation of a group. */
  readonly chatId: string;
  /** The chat session of the agent in the chat; `null` before its first message. */
  readonly sessionId: string | null;
  /** Whether the viewer may change the model and restart or compact the session. */
  readonly canControl: boolean;
}

function readIdentifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    throw new AgentEmployeeError("invalidInput");
  return value;
}

/**
 * Reads the chat of a request of the page.
 *
 * @param input - The untrusted fields `kind`, `agentId` and `conversationId`.
 * @throws {AgentEmployeeError} `invalidInput` for a malformed target.
 */
export function readAgentChatTarget(input: {
  readonly kind: unknown;
  readonly agentId: unknown;
  readonly conversationId?: unknown;
}): AgentChatControlTarget {
  const agentId = readIdentifier(input.agentId);
  if (input.kind === "direct") return { kind: "direct", agentId };
  if (input.kind !== "group") throw new AgentEmployeeError("invalidInput");
  return {
    kind: "group",
    agentId,
    conversationId: readIdentifier(input.conversationId),
  };
}

/**
 * Who may steer an agent in a chat (PAGE-380).
 *
 * @remarks
 * In a direct chat the person who talks with the agent may always. In a group
 * the one who created it may, and every member that person allowed. An agent
 * never may: neither a command in its message nor a tool changes the model or
 * the session of an agent. Somebody outside the chat gets `notFound`, as for a
 * chat that does not exist.
 */
export class AgentChatAccess {
  private readonly dependencies: AgentChatAccessDependencies;

  public constructor(dependencies: AgentChatAccessDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The agent of a chat the viewer takes part in.
   *
   * @throws {AgentEmployeeError} `notFound` for an account that is no agent,
   * a group the viewer or the agent is no member of.
   */
  public async scope(
    viewer: User,
    target: AgentChatControlTarget,
  ): Promise<AgentChatScope> {
    const { store, users } = this.dependencies;
    const [agent, employee] = await Promise.all([
      users.findById(target.agentId),
      store.employees().find(target.agentId),
    ]);
    if (agent?.isAgent !== true || !employee)
      throw new AgentEmployeeError("notFound");
    if (target.kind === "direct") {
      if (viewer.isAgent === true) throw new AgentEmployeeError("notFound");
      const session = await store
        .conversations()
        .find(agent.id, viewer.id, "chat");
      return {
        agent,
        employee,
        kind: "direct",
        chatId: viewer.id,
        sessionId: session?.sessionId ?? null,
        canControl: true,
      };
    }
    const conversationId = target.conversationId ?? "";
    await this.requireGroupMembers(conversationId, [viewer.id, agent.id]);
    const session = await store
      .conversations()
      .find(agent.id, conversationId, "conversation");
    return {
      agent,
      employee,
      kind: "group",
      chatId: conversationId,
      sessionId: session?.sessionId ?? null,
      canControl: await this.canControlGroup(viewer, conversationId),
    };
  }

  /** Whether the viewer may steer the agents of a group: its creator or a member the creator allowed. */
  public async canControlGroup(
    viewer: User,
    conversationId: string,
  ): Promise<boolean> {
    if (viewer.isAgent === true) return false;
    if (await this.isOwner(viewer, conversationId)) return true;
    const allowed = await this.dependencies.store
      .sessionControllers()
      .list(conversationId);
    return allowed.includes(viewer.id);
  }

  /** Whether the viewer created the group; an agent never counts. */
  public async isOwner(viewer: User, conversationId: string): Promise<boolean> {
    if (viewer.isAgent === true) return false;
    return (
      (await this.dependencies.conversations.createdBy(conversationId)) ===
      viewer.id
    );
  }

  /** The members of a group the viewer takes part in. */
  public async groupMembers(
    viewer: User,
    conversationId: string,
  ): Promise<string[]> {
    const record = await this.dependencies.conversations.findForMember(
      conversationId,
      viewer.id,
    );
    if (record?.kind !== "group") throw new AgentEmployeeError("notFound");
    const members = await this.dependencies.conversations.memberIds([
      conversationId,
    ]);
    return members.get(conversationId) ?? [];
  }

  private async requireGroupMembers(
    conversationId: string,
    userIds: readonly string[],
  ): Promise<void> {
    const [first] = userIds;
    if (first === undefined) throw new AgentEmployeeError("notFound");
    const record = await this.dependencies.conversations.findForMember(
      conversationId,
      first,
    );
    if (record?.kind !== "group") throw new AgentEmployeeError("notFound");
    const members =
      (await this.dependencies.conversations.memberIds([conversationId])).get(
        conversationId,
      ) ?? [];
    if (!userIds.every((id) => members.includes(id)))
      throw new AgentEmployeeError("notFound");
  }
}
