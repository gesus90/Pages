import { z } from "zod";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_DECISION_LIMITS,
  CONVERSATION_NO_RULE_OVERRIDES,
  CONVERSATION_REPLY_MODES,
  isValidDecisionRules,
  resolveDecisionRules,
} from "@/definition/ConversationDecision";

import { decisionEntry } from "./ConversationDecisionViews";
import {
  CONVERSATION_ROUND_LIMITS_RANGE,
  conversationRoundLimits,
} from "@/definition/ConversationObserver";

import { readConversationIdentifier } from "./ConversationReader";

import type { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  ConversationDecisionEntry,
  ConversationDecisionHint,
  ConversationReplySettings,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { ChatDecisionSettingsService } from "../chat/ChatDecisionSettingsService";
import type { ConversationDirectory } from "./ConversationDirectory";

/** What the settings of a group are read and checked with. */
export interface ConversationReplySettingsDependencies {
  readonly conversations: Pick<
    ConversationRepository,
    "findForMember" | "createdBy"
  >;
  readonly settings: ConversationReplySettingsRepository;
  /** The stored decisions, for the list and the hint. */
  readonly decisions: Pick<
    ConversationDecisionRepository,
    "recent" | "latestFallback"
  >;
  /** The decision model and the default rules of the instance. */
  readonly instance: Pick<ChatDecisionSettingsService, "rules" | "modelView">;
  readonly directory: Pick<ConversationDirectory, "read">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
}

const SETTINGS_INPUT = z
  .object({
    conversationId: z.string(),
    mode: z.enum(CONVERSATION_REPLY_MODES),
    // `null` leaves every value to the defaults of the instance.
    rules: z
      .object({
        answerThreshold: z.number(),
        responsibilityThreshold: z.number(),
        secondThreshold: z.number(),
        maximumResponders: z.number(),
      })
      .strict()
      .nullable(),
    // The most contributions without @ per group round; absent keeps the stored one (PAGE-349).
    automaticRepliesPerOrigin: z
      .number()
      .int()
      .min(1)
      .max(CONVERSATION_ROUND_LIMITS_RANGE.automaticRepliesMaximum)
      .optional(),
  })
  .strict();

/**
 * The settings "Wer antwortet?" of group chats (PAGE-317, PAGE-379).
 *
 * @remarks
 * Every member reads them and the last decisions; only the account that
 * manages the group, the one that created it, changes them. The mode is
 * `mentions` or `decision`. The thresholds and the most answering agents are
 * the group's own or, without a value of its own, the defaults of the
 * instance. The decision model is no part of them: it is the one of the
 * instance. Direct conversations have no such setting.
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
    const { instance } = this.dependencies;
    const [settings, defaults, decisionModel, canManage] = await Promise.all([
      this.dependencies.settings.find(id),
      instance.rules(),
      instance.modelView(),
      this.canManage(person, id),
    ]);
    const { overrides } = settings;
    return {
      conversationId: id,
      mode: settings.mode,
      rules: resolveDecisionRules(defaults, overrides),
      ...conversationRoundLimits(settings),
      defaults,
      isDefault: Object.values(overrides).every((value) => value === null),
      canManage,
      decisionModel,
      hint:
        canManage && settings.mode === "decision"
          ? await this.hint(id, decisionModel.status)
          : null,
    };
  }

  /**
   * Changes the settings of a group the person manages.
   *
   * @param person - The signed-in account.
   * @param input - Group, mode and the rules; `rules: null` returns the
   * thresholds and the most answering agents to the defaults of the instance.
   * @returns The stored settings as {@link read} gives them.
   * @throws {ConversationError} `not_found` as {@link read}, `forbidden` for a
   * member who does not manage the group, `invalid` for input that does not
   * fit or rules out of range.
   */
  public async save(
    person: User,
    input: unknown,
  ): Promise<ConversationReplySettingsView> {
    const parsed = SETTINGS_INPUT.safeParse(input);
    if (!parsed.success) throw new ConversationError("invalid");
    const current = await this.read(person, parsed.data.conversationId);
    if (!current.canManage) throw new ConversationError("forbidden");
    const { rules } = parsed.data;
    if (rules !== null && !isValidDecisionRules(rules))
      throw new ConversationError("invalid");
    const settings: ConversationReplySettings = {
      conversationId: current.conversationId,
      mode: parsed.data.mode,
      overrides: rules ?? CONVERSATION_NO_RULE_OVERRIDES,
      ...conversationRoundLimits({
        automaticRepliesPerOrigin:
          parsed.data.automaticRepliesPerOrigin ??
          current.automaticRepliesPerOrigin,
      }),
    };
    await this.dependencies.settings.save({
      settings,
      updatedBy: person.id,
      updatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
    });
    this.dependencies.publisher.publish({
      type: "conversation.changed",
      id: settings.conversationId,
    });
    return this.read(person, current.conversationId);
  }

  /**
   * Lists the newest decisions of a group the person belongs to.
   *
   * @returns The decisions, newest first, with the text of their messages:
   * the model's answer with its probabilities, "no answer", an @ addressing,
   * or that the model was unavailable.
   * @throws {ConversationError} `not_found` as {@link read}.
   */
  public async decisions(
    person: User,
    conversationId: unknown,
  ): Promise<ConversationDecisionEntry[]> {
    const id = readConversationIdentifier(conversationId);
    const record = await this.dependencies.conversations.findForMember(
      id,
      person.id,
    );
    if (record?.kind !== "group") throw new ConversationError("not_found");
    const [listed, accounts] = await Promise.all([
      this.dependencies.decisions.recent(
        id,
        CONVERSATION_DECISION_LIMITS.listedDecisions,
      ),
      this.dependencies.directory.read(),
    ]);
    return listed.map((entry) => decisionEntry(entry, accounts));
  }

  /** Why decisions cannot run now; `null` when they can. */
  private async hint(
    conversationId: string,
    status: "noModel" | "modelUnavailable" | "ready",
  ): Promise<ConversationDecisionHint | null> {
    if (status !== "ready") return status;
    const fallback =
      await this.dependencies.decisions.latestFallback(conversationId);
    return fallback === "model_failed" ? "modelFailed" : null;
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
}
