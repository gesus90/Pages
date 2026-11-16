import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ConversationService } from "@/backend/service/conversation/ConversationService";
import type {
  ChatGroupMemberView,
  ChatGroupMembersView,
} from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";
import type { AgentChatAccess } from "./AgentChatAccess";
import type { AgentChatSessionLifecycle } from "./AgentChatSessionLifecycle";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

const COMPONENT = "ChatGroupMembershipService";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

/** What the members of a group are read and changed with. */
export interface ChatGroupMembershipDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly access: Pick<
    AgentChatAccess,
    "isOwner" | "groupMembers" | "canControlGroup"
  >;
  readonly conversations: Pick<
    ConversationService,
    "removeMember" | "removeGroup" | "postSystemLine"
  >;
  readonly lifecycle: Pick<AgentChatSessionLifecycle, "close">;
  readonly models: Pick<AgentEmployeeModels, "describe">;
  /** Stops the running answer of one agent in a group, as the person asks. */
  readonly stopAnswer: (
    person: User,
    conversationId: string,
    agentId: string,
  ) => Promise<void>;
  readonly now?: () => Date;
}

function readIdentifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    throw new AgentEmployeeError("invalidInput");
  return value;
}

function readIdentifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new AgentEmployeeError("invalidInput");
  return [...new Set(value.map(readIdentifier))];
}

function avatarImage(user: User): string | null {
  return user.avatarType === "image" ? (user.avatarImageUrl ?? null) : null;
}

/**
 * The members of a group and its end.
 * @remarks
 * Only the one who created a group removes a member, person or agent, as
 * only that person adds one; an agent never joins or leaves a group on its
 * own. A removed agent loses its session in the group: Pages stops a running
 * answer, lets the agent write its state into the Lagebuch (not in a
 * confidential group), closes and deletes the session and its model of the
 * group. Dissolving a group does that for every agent at once and deletes
 * the history with its attachments, preview images and decisions for good.
 * `MEMORY.md`, `DREAM.md`, lessons, recipes and the Lagebuch of the agents
 * stay.
 */
export class ChatGroupMembershipService {
  private readonly dependencies: ChatGroupMembershipDependencies;

  public constructor(dependencies: ChatGroupMembershipDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The members of a group the viewer takes part in.
   * @throws {AgentEmployeeError} `notFound` for a group the viewer is no member of.
   */
  public async members(
    viewer: User,
    groupId: unknown,
  ): Promise<ChatGroupMembersView> {
    const id = readIdentifier(groupId);
    const { access, store } = this.dependencies;
    const memberIds = await access.groupMembers(viewer, id);
    const [isOwner, controllers, titles, models] = await Promise.all([
      access.isOwner(viewer, id),
      store.sessionControllers().list(id),
      store.identities().jobTitles(),
      store.chatModels().forChat("group", id),
    ]);
    const owners = await Promise.all(
      memberIds.map(async (memberId) => {
        const user = await this.dependencies.users.findById(memberId);
        return user ? { user, isOwner: await access.isOwner(user, id) } : null;
      }),
    );
    const members: ChatGroupMemberView[] = [];
    for (const entry of owners) {
      if (entry === null) continue;
      const { user } = entry;
      const isAgent = user.isAgent === true;
      const stored = models.find((model) => model.agentId === user.id);
      members.push({
        id: user.id,
        name: user.displayName,
        kind: isAgent ? "agent" : "human",
        username: user.username,
        role: isAgent ? (titles.get(user.id) ?? "") : "",
        color: user.avatarColor ?? null,
        avatarImageUrl: avatarImage(user),
        isOwner: entry.isOwner,
        canControl:
          !isAgent && (entry.isOwner || controllers.includes(user.id)),
        ...(stored
          ? {
              model: {
                name: (await this.dependencies.models.describe(stored))
                  .modelName,
                reasoningEffort: stored.reasoningEffort,
                isOverride: true,
                contextWindow: null,
              },
            }
          : {}),
      });
    }
    return { groupId: id, members, canManage: isOwner };
  }

  /**
   * Chooses the members besides the creator that may steer the agents of the
   * group; agents are never chosen.
   * @throws {AgentEmployeeError} `forbidden` for a viewer who did not create
   * the group, `invalidInput` for an agent or somebody outside it.
   */
  public async saveControllers(
    viewer: User,
    groupId: unknown,
    userIds: unknown,
  ): Promise<ChatGroupMembersView> {
    const id = readIdentifier(groupId);
    const ids = readIdentifiers(userIds).filter(
      (userId) => userId !== viewer.id,
    );
    await this.requireOwner(viewer, id);
    const memberIds = await this.dependencies.access.groupMembers(viewer, id);
    for (const userId of ids) {
      const user = await this.dependencies.users.findById(userId);
      if (!memberIds.includes(userId) || !user || user.isAgent === true)
        throw new AgentEmployeeError("invalidInput");
    }
    await this.dependencies.store
      .sessionControllers()
      .replace(id, { userIds: ids, at: this.now() });
    return this.members(viewer, id);
  }

  /**
   * Removes a member from the group; a removed agent loses its session and
   * its model of the group.
   * @throws {AgentEmployeeError} `forbidden` for a viewer who did not create
   * the group, `invalidInput` for the creator.
   */
  public async removeMember(
    viewer: User,
    groupId: unknown,
    memberId: unknown,
  ): Promise<void> {
    const id = readIdentifier(groupId);
    const member = readIdentifier(memberId);
    await this.requireOwner(viewer, id);
    if (member === viewer.id) throw new AgentEmployeeError("invalidInput");
    const memberIds = await this.dependencies.access.groupMembers(viewer, id);
    if (!memberIds.includes(member)) return;
    const user = await this.dependencies.users.findById(member);
    if (user?.isAgent === true) await this.closeAgent(viewer, id, user);
    const { store } = this.dependencies;
    await store.groups().removeMember(viewer.id, id, member);
    await store.sessionControllers().remove(id, member);
    await this.dependencies.conversations.removeMember(viewer, {
      conversationId: id,
      memberId: member,
    });
    await this.announce(viewer, id, user?.displayName ?? member);
  }

  /**
   * Dissolves the group: every agent loses its session in it, and its
   * history is deleted for good. A running answer is cancelled.
   * @throws {AgentEmployeeError} `forbidden` for a viewer who did not create the group.
   */
  public async dissolve(viewer: User, groupId: unknown): Promise<void> {
    const id = readIdentifier(groupId);
    await this.requireOwner(viewer, id);
    const memberIds = await this.dependencies.access.groupMembers(viewer, id);
    const users = await Promise.all(
      memberIds.map((memberId) => this.dependencies.users.findById(memberId)),
    );
    const agents = users.filter((user): user is User => user?.isAgent === true);
    // The agents lose their sessions at once; each writes its state down first.
    await Promise.all(
      agents.map((agent) => this.closeAgent(viewer, id, agent)),
    );
    const { store } = this.dependencies;
    await store.chatModels().removeForChat("group", id);
    await store.groups().remove(viewer.id, id);
    await this.dependencies.conversations.removeGroup(viewer, id);
  }

  /** Stops the answer of an agent in the group and closes and deletes its session and model there. */
  private async closeAgent(
    viewer: User,
    conversationId: string,
    agent: User,
  ): Promise<void> {
    const { store, lifecycle } = this.dependencies;
    try {
      await this.dependencies.stopAnswer(viewer, conversationId, agent.id);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
    await store.chatModels().remove({
      agentId: agent.id,
      chatKind: "group",
      chatId: conversationId,
    });
    const session = await store
      .conversations()
      .find(agent.id, conversationId, "conversation");
    if (!session) return;
    try {
      await lifecycle.close(agent, session.sessionId, { isAborted: true });
    } catch (error: unknown) {
      // The session must not outlive the membership: its row goes in any case.
      logCaughtError(COMPONENT, error);
      await store.chatSessions().remove(session.sessionId);
    }
  }

  private async announce(
    viewer: User,
    conversationId: string,
    name: string,
  ): Promise<void> {
    try {
      await this.dependencies.conversations.postSystemLine(viewer, {
        conversationId,
        text: `${viewer.displayName} hat ${name} aus der Gruppe entfernt.`,
      });
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  private async requireOwner(viewer: User, groupId: string): Promise<void> {
    await this.dependencies.access.groupMembers(viewer, groupId);
    if (!(await this.dependencies.access.isOwner(viewer, groupId)))
      throw new AgentEmployeeError("forbidden");
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
