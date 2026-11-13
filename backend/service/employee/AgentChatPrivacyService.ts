import { z } from "zod";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** A change of the mark, as the chat page sends it: an agent's direct chat or a conversation. */
const confidentialInput = z.union([
  z.object({
    agentId: z.string().regex(IDENTIFIER),
    isConfidential: z.enum(["true", "false"]),
  }),
  z.object({
    conversationId: z.string().regex(IDENTIFIER),
    isConfidential: z.enum(["true", "false"]),
  }),
]);

/** What the mark reads and writes. */
export interface AgentChatPrivacyDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  /** An unused ID for the chat session of a direct chat that has none yet. */
  readonly createSessionId: () => string;
}

/**
 * Marks a chat with agents confidential (PAGE-305): nothing of it reaches
 * `MEMORY.md`, the archive or `DREAM.md`, and nothing of it is shared with
 * another chat. Its entries leave the Lagebuch of the agents (PAGE-377).
 *
 * @remarks
 * The person marks their own direct chat with an agent, or a stored
 * conversation they are a member of, for all its members.
 */
export class AgentChatPrivacyService {
  private readonly dependencies: AgentChatPrivacyDependencies;

  public constructor(dependencies: AgentChatPrivacyDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Sets or clears the mark of one chat of the person.
   *
   * @throws {AgentEmployeeError} `invalidInput` for a malformed request,
   * `notFound` for an unknown agent or a conversation of which the person
   * is no member.
   */
  public async setConfidential(person: User, input: unknown): Promise<void> {
    const parsed = confidentialInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const isConfidential = parsed.data.isConfidential === "true";
    const chats = this.dependencies.store.chats();
    if ("agentId" in parsed.data) {
      const { agentId } = parsed.data;
      const agent = await this.dependencies.users.findById(agentId);
      if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
      // A chat without any message yet gets its session now, so the mark holds from the start.
      await this.dependencies.store
        .conversations()
        .ensure(
          { agentId, personId: person.id, purpose: "chat" },
          this.dependencies.createSessionId(),
        );
      await chats.setDirectConfidential(agentId, person.id, isConfidential);
      // A confidential chat leaves the Lagebuch of the agent (PAGE-377).
      if (isConfidential)
        await this.dependencies.store
          .logbook()
          .removeChat({ kind: "direct", id: person.id }, agentId);
      return;
    }
    const { conversationId } = parsed.data;
    const people = await chats.conversationPeople(conversationId);
    if (!people.includes(person.id)) throw new AgentEmployeeError("notFound");
    await chats.setConversationConfidential(conversationId, isConfidential);
    // The group leaves the Lagebuch of every agent that took part (PAGE-377).
    if (isConfidential)
      await this.dependencies.store
        .logbook()
        .removeChat({ kind: "group", id: conversationId }, null);
  }
}
