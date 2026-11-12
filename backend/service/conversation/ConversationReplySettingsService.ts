import { z } from "zod";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_MAXIMUM_RESPONDERS_RANGE,
  CONVERSATION_REPLY_MODES,
} from "@/definition/ConversationDecision";

import { readConversationIdentifier } from "./ConversationReader";

import type { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  ConversationDecisionAgent,
  ConversationReplySettings,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { ConversationDirectory } from "./ConversationDirectory";

/** What the settings of a group are read and checked with. */
export interface ConversationReplySettingsDependencies {
  readonly conversations: Pick<
    ConversationRepository,
    "findForMember" | "createdBy" | "memberIds"
  >;
  readonly settings: ConversationReplySettingsRepository;
  readonly directory: Pick<ConversationDirectory, "read">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
}

const SETTINGS_INPUT = z
  .object({
    conversationId: z.string(),
    mode: z.enum(CONVERSATION_REPLY_MODES),
    defaultResponderId: z.string().min(1).max(100).nullable(),
    maximumResponders: z
      .number()
      .int()
      .min(CONVERSATION_MAXIMUM_RESPONDERS_RANGE.minimum)
      .max(CONVERSATION_MAXIMUM_RESPONDERS_RANGE.maximum),
  })
  .strict();

/**
 * The settings "Wer antwortet?" of group chats (PAGE-317).
 *
 * @remarks
 * Every member reads them; only the account that manages the group, the one
 * that created it, changes them. The chat model is no part of them: it is the
 * decision model of the instance. The default responder must be an agent
 * member of the group. Direct conversations have no such setting.
 */
export class ConversationReplySettingsService {
  private readonly dependencies: ConversationReplySettingsDependencies;

  public constructor(dependencies: ConversationReplySettingsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the settings of a group the person belongs to.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member and for a direct conversation.
   */
  public async read(
    person: User,
    conversationId: unknown,
  ): Promise<ConversationReplySettingsView> {
    const id = readConversationIdentifier(conversationId);
    const record = await this.dependencies.conversations.findForMember(
      id,
      person.id,
    );
    if (record?.kind !== "group") throw new ConversationError("not_found");
    return {
      ...(await this.dependencies.settings.find(id)),
      canManage: await this.canManage(person, id),
      agents: await this.agentMembers(id),
    };
  }

  /**
   * Changes the settings of a group the person manages.
   *
   * @param person - The signed-in account.
   * @param input - Group, mode, default responder and the most answering agents.
   * @returns The stored settings.
   * @throws {ConversationError} `not_found` as {@link read}, `forbidden` for a
   * member who does not manage the group, `invalid` for input that does not
   * fit or a default responder that is no agent member of the group.
   */
  public async save(
    person: User,
    input: unknown,
  ): Promise<ConversationReplySettingsView> {
    const parsed = SETTINGS_INPUT.safeParse(input);
    if (!parsed.success) throw new ConversationError("invalid");
    const current = await this.read(person, parsed.data.conversationId);
    if (!current.canManage) throw new ConversationError("forbidden");
    const settings: ConversationReplySettings = {
      conversationId: current.conversationId,
      mode: parsed.data.mode,
      defaultResponderId: parsed.data.defaultResponderId,
      maximumResponders: parsed.data.maximumResponders,
    };
    await this.requireAgentMember(settings, current.agents);
    await this.dependencies.settings.save({
      settings,
      updatedBy: person.id,
      updatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
    });
    this.dependencies.publisher.publish({
      type: "conversation.changed",
      id: settings.conversationId,
    });
    return { ...settings, canManage: true, agents: current.agents };
  }

  private async canManage(
    person: User,
    conversationId: string,
  ): Promise<boolean> {
    return (
      (await this.dependencies.conversations.createdBy(conversationId)) ===
      person.id
    );
  }

  /** The agents among the members of the group, with their names. */
  private async agentMembers(
    conversationId: string,
  ): Promise<ConversationDecisionAgent[]> {
    const members = await this.dependencies.conversations.memberIds([
      conversationId,
    ]);
    const accounts = await this.dependencies.directory.read();
    return (members.get(conversationId) ?? []).flatMap((id) => {
      const account = accounts.find(id);
      return account?.user.isAgent === true
        ? [{ id, name: account.user.displayName }]
        : [];
    });
  }

  private requireAgentMember(
    settings: ConversationReplySettings,
    agents: readonly ConversationDecisionAgent[],
  ): void {
    const { defaultResponderId } = settings;
    if (defaultResponderId === null) return;
    if (!agents.some((agent) => agent.id === defaultResponderId))
      throw new ConversationError("invalid");
  }
}
