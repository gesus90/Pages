import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ConversationError } from "@/backend/error/ConversationError";

import { readConversationIdentifier } from "./ConversationReader";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type {
  AgentConversationRecord,
  ConversationAgentChatRepository,
} from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { ConversationHistoryPage } from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  ConversationReader,
  ConversationView,
} from "./ConversationReader";

/** Conversations of agents one overseer lists at most. */
const OVERSIGHT_LIMIT = 200;

/** What the oversight of conversations of agents reads. */
export interface ConversationOversightDependencies {
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly chat: Pick<
    ConversationAgentChatRepository,
    "listAgentOnly" | "findAgentOnly" | "projectMemberIds"
  >;
  readonly reader: Pick<
    ConversationReader,
    "inspect" | "inspectHistory" | "memberIds"
  >;
}

/**
 * Who reads the conversations that only agents take part in (PAGE-311).
 *
 * @remarks
 * Administrators in the admin mode read all of them. A leader reads those
 * with an agent they lead: the head of a department reads the conversations
 * of agents in the department, a project manager those of agents who are
 * members of the manager's projects. Everybody else sees no such
 * conversation; one that does not exist for them answers `not_found`. The
 * right is resolved afresh from the stored account on every read.
 */
export class ConversationOversight {
  private readonly dependencies: ConversationOversightDependencies;

  public constructor(dependencies: ConversationOversightDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the conversations of agents only the person oversees, with their newest messages. */
  public async views(viewer: User): Promise<ConversationView[]> {
    const scope = await this.scope(viewer);
    if (scope === null) return [];
    const records = await this.dependencies.chat.listAgentOnly(
      scope === "all" ? null : scope,
      OVERSIGHT_LIMIT,
    );
    return this.dependencies.reader.inspect(viewer, records);
  }

  /**
   * Tells whether the person oversees a conversation of agents only.
   *
   * @returns Whether the person reads and releases it, and that it exists as such.
   */
  public async canOversee(
    viewer: User,
    conversationId: string,
  ): Promise<boolean> {
    return (await this.find(viewer, conversationId)) !== null;
  }

  /**
   * Reads a page of the history of an overseen conversation.
   *
   * @throws {ConversationError} `not_found` for a conversation the person
   * does not oversee, `invalid` for a message outside it.
   */
  public async history(
    viewer: User,
    conversationId: string,
    beforeId: string | null,
  ): Promise<ConversationHistoryPage> {
    const record = await this.find(viewer, conversationId);
    if (!record) throw new ConversationError("not_found");
    return this.dependencies.reader.inspectHistory(record.id, beforeId);
  }

  private async find(
    viewer: User,
    conversationId: string,
  ): Promise<AgentConversationRecord | null> {
    const scope = await this.scope(viewer);
    if (scope === null) return null;
    const record = await this.dependencies.chat.findAgentOnly(
      readConversationIdentifier(conversationId),
    );
    if (!record || scope === "all") return record;
    const members = await this.dependencies.reader.memberIds(record.id);
    return members.some((id) => scope.includes(id)) ? record : null;
  }

  /** The agents the person oversees: `all`, a list of agent IDs, or `null` for none. */
  private async scope(viewer: User): Promise<"all" | string[] | null> {
    const { accounts } = await this.dependencies.authorization.snapshot();
    const account = accounts.find(({ userId }) => userId === viewer.id);
    if (!account?.isActive || account.isAgent === true) return null;
    if (new UserPolicyService().isAdministrator(account)) return "all";
    const departments = new Set(account.managedDepartments);
    const projectMembers = new Set(
      await this.dependencies.chat.projectMemberIds(viewer.id),
    );
    const led = accounts
      .filter(
        (agent: AccountAccess) =>
          agent.isAgent === true &&
          agent.isActive &&
          (projectMembers.has(agent.userId) ||
            agent.departments.some((id) => departments.has(id))),
      )
      .map(({ userId }) => userId);
    return led.length === 0 ? null : led;
  }
}
