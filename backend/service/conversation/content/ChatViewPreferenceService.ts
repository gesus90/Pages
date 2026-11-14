import { ConversationError } from "@/backend/error/ConversationError";
import {
  chatCardStateSchema,
  chatListCollapsedSchema,
  chatSplitWidthSchema,
} from "@/definition/ConversationContent";

import type { ChatViewPreferenceRepository } from "@/backend/database/repositories/conversation/ChatViewPreferenceRepository";
import type { ChatViewPreferences } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";

/**
 * What a person chose for the content cards of the chat and the split view
 * (PAGE-298) and for the list of the chat page (PAGE-325), kept per account
 * so it holds on every device.
 */
export class ChatViewPreferenceService {
  private readonly preferences: ChatViewPreferenceRepository;
  private readonly now: () => Date;

  /**
   * Creates the service.
   *
   * @param preferences - The stored choices.
   * @param now - The clock; the system clock by default.
   */
  public constructor(
    preferences: ChatViewPreferenceRepository,
    now: () => Date = () => new Date(),
  ) {
    this.preferences = preferences;
    this.now = now;
  }

  /** Reads the card states, the split width and the list state of the person. */
  public async read(person: User): Promise<ChatViewPreferences> {
    const [cardStates, splitWidth, isListCollapsed] = await Promise.all([
      this.preferences.cardStates(person.id),
      this.preferences.splitWidth(person.id),
      this.preferences.isListCollapsed(person.id),
    ]);
    return { cardStates, splitWidth, isListCollapsed };
  }

  /**
   * Stores whether the person collapsed or expanded a card.
   *
   * @throws {ConversationError} `invalid` for an unusable card key or state.
   */
  public async setCardState(
    person: User,
    input: { readonly cardKey: unknown; readonly state: unknown },
  ): Promise<void> {
    const change = chatCardStateSchema.safeParse(input);
    if (!change.success) throw new ConversationError("invalid");
    await this.preferences.setCardState(person.id, {
      ...change.data,
      updatedAt: this.now().toISOString(),
    });
  }

  /**
   * Stores the width the person gave the split view.
   *
   * @throws {ConversationError} `invalid` below 360 pixels or for no number.
   */
  public async setSplitWidth(person: User, input: unknown): Promise<void> {
    const width = chatSplitWidthSchema.safeParse(input);
    if (!width.success) throw new ConversationError("invalid");
    await this.preferences.setSplitWidth(
      person.id,
      width.data,
      this.now().toISOString(),
    );
  }

  /**
   * Stores whether the person collapsed the list of the chat page (PAGE-325).
   *
   * @throws {ConversationError} `invalid` for anything but `true` or `false`.
   */
  public async setListCollapsed(person: User, input: unknown): Promise<void> {
    const isCollapsed = chatListCollapsedSchema.safeParse(input);
    if (!isCollapsed.success) throw new ConversationError("invalid");
    await this.preferences.setListCollapsed(
      person.id,
      isCollapsed.data,
      this.now().toISOString(),
    );
  }
}
