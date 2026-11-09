import type { ConversationErrorCode } from "@/definition/Conversation";

/**
 * A refused conversation request (PAGE-278), without persistence details.
 *
 * @remarks
 * A conversation of which the account is no member answers `not_found`, as a
 * missing one does, so an ID never tells whether it exists.
 */
export class ConversationError extends Error {
  public readonly code: ConversationErrorCode;

  /**
   * Creates the refusal.
   *
   * @param code - The reason the web and Pica Mobile translate.
   */
  public constructor(code: ConversationErrorCode) {
    super(code);
    this.name = "ConversationError";
    this.code = code;
  }
}
