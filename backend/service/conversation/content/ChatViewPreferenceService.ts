import { ConversationError } from "@/backend/error/ConversationError";
import {
  chatCardStateSchema,
  chatLastChatSchema,
  chatListCollapsedSchema,
  chatReadingPositionSchema,
  chatSplitWidthSchema,
} from "@/definition/ConversationContent";

import type { ChatViewPreferenceRepository } from "@/backend/database/repositories/conversation/ChatViewPreferenceRepository";
import type { ChatViewPreferences } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";

/**
 * What a person chose for the content cards of the chat and the split view
 * and for the list of the chat page, the chat used last and where they
 * stopped reading in each chat, kept per account so it holds on every device.
 */
export class ChatViewPreferenceService {
  private readonly preferences: ChatViewPreferenceRepository;
  private readonly now: () => Date;

  /**
   * Creates the service.
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

  /** Reads the card states, the split width, the list state, the last chat and the reading positions of the person. */
  public async read(person: User): Promise<ChatViewPreferences> {
    const [
      cardStates,
      splitWidth,
      isListCollapsed,
      lastChat,
      readingPositions,
    ] = await Promise.all([
      this.preferences.cardStates(person.id),
      this.preferences.splitWidth(person.id),
      this.preferences.isListCollapsed(person.id),
      this.preferences.lastChat(person.id),
      this.preferences.readingPositions(person.id),
    ]);
    return {
      cardStates,
      splitWidth,
      isListCollapsed,
      lastChat,
      readingPositions,
    };
  }

  /**
   * Stores whether the person collapsed or expanded a card.
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
   * Stores whether the person collapsed the list of the chat page.
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

  /**
   * Stores the chat the person used last.
   * @remarks
   * Whether the person may still open it is decided when the page reads it:
   * a chat that is no longer in their lists is not opened.
   * @throws {ConversationError} `invalid` for a kind or an ID that names no chat.
   */
  public async setLastChat(person: User, input: unknown): Promise<void> {
    const chat = chatLastChatSchema.safeParse(input);
    if (!chat.success) throw new ConversationError("invalid");
    await this.preferences.setLastChat(
      person.id,
      chat.data,
      this.now().toISOString(),
    );
  }

  /**
   * Stores where the person stopped reading in a chat, or forgets it when
   * they read the chat to its end.
   * @throws {ConversationError} `invalid` for a chat key or a message ID of
   * no usable form.
   */
  public async setReadingPosition(person: User, input: unknown): Promise<void> {
    const position = chatReadingPositionSchema.safeParse(input);
    if (!position.success) throw new ConversationError("invalid");
    const { chatKey, messageId } = position.data;
    if (messageId === null) {
      await this.preferences.clearReadingPosition(person.id, chatKey);
      return;
    }
    await this.preferences.setReadingPosition(person.id, {
      chatKey,
      messageId,
      updatedAt: this.now().toISOString(),
    });
  }
}
