import {
  DEFAULT_BOARD_PREFERENCES,
  normalizeBoardPreferences,
  parseStoredBoardPreferences,
  serializeBoardPreferences,
} from "@/definition/BoardPreferences";

import type { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import type { BoardPreferences } from "@/definition/BoardPreferences";

/** Keeps the task board view each user chose; every user only reaches their own. */
export class BoardPreferencesService {
  private readonly repository: UserBoardPreferencesRepository;

  /**
   * Creates a board preferences service.
   *
   * @param repository - Board preferences persistence boundary.
   */
  public constructor(repository: UserBoardPreferencesRepository) {
    this.repository = repository;
  }

  /**
   * Returns the saved board preferences of a user.
   *
   * @param userId - User identifier.
   * @returns The saved preferences, or the defaults when nothing valid is saved.
   */
  public async find(userId: string): Promise<BoardPreferences> {
    const stored = await this.repository.findByUserId(userId);

    return stored === null
      ? DEFAULT_BOARD_PREFERENCES
      : parseStoredBoardPreferences(stored);
  }

  /**
   * Saves the board preferences of a user.
   *
   * @param userId - User identifier.
   * @param raw - Untrusted preferences; invalid fields are stored as defaults.
   * @returns The preferences that were stored.
   */
  public async save(userId: string, raw: unknown): Promise<BoardPreferences> {
    const preferences = normalizeBoardPreferences(raw);

    await this.repository.upsert(
      userId,
      serializeBoardPreferences(preferences),
    );

    return preferences;
  }
}
