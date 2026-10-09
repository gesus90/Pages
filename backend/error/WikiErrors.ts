import type { WikiPage } from "@/definition/Wiki";

/**
 * Reasons a wiki action is rejected, with the message logged for each.
 *
 * @remarks
 * The code is what the client receives; it translates the code into the
 * language of the user (`wiki.errors.<code>`). The English message stays for
 * logs and tests.
 */
export const WIKI_ERROR_MESSAGES = {
  commentRequired: "A comment must not be empty.",
  commentTooLong: "A comment must not exceed 5,000 characters.",
  contentTooLong: "The page text must not exceed 200,000 characters.",
  fileEmpty: "The file is empty.",
  fileNameTooLong: "A file name must not exceed 255 characters.",
  fileTooLarge: "The file exceeds the size limit set for its kind.",
  invalidAnchor: "The page cannot be tied to this target.",
  invalidCover: "The cover must be a prepared cover or an image of the page.",
  invalidDate: "The date must use the format YYYY-MM-DD.",
  invalidIcon: "The icon must be a single emoji.",
  invalidParent: "The page cannot be placed below this page.",
  invalidPosition: "The page cannot be placed at this position.",
  invalidScope: "The page cannot be moved to this area.",
  invalidSetting: "The setting is outside its permitted range.",
  notInTrash: "The page is not in the trash.",
  titleRequired: "A page needs a title.",
  titleTooLong: "A page title must not exceed 200 characters.",
  treeTooDeep: "Pages can be nested at most 10 levels deep.",
  versionMissing: "The version does not exist.",
} as const;

/** A reason a wiki input is rejected. */
export type WikiErrorCode = keyof typeof WIKI_ERROR_MESSAGES;

/** Thrown when wiki input violates a documented rule. */
export class WikiValidationError extends Error {
  /** Code the client translates. */
  public readonly code: WikiErrorCode;

  /**
   * Creates the error.
   *
   * @param code - Reason of the rejection.
   */
  public constructor(code: WikiErrorCode) {
    super(WIKI_ERROR_MESSAGES[code]);
    this.name = "WikiValidationError";
    this.code = code;
  }
}

/**
 * Thrown when a page does not exist or the actor may not see it; callers
 * must not be able to tell the two apart.
 */
export class WikiPageNotFoundError extends Error {
  public constructor() {
    super("The page does not exist or you have no access to it.");
    this.name = "WikiPageNotFoundError";
  }
}

/** Thrown when the actor sees a page but may not do what they asked. */
export class WikiAccessDeniedError extends Error {
  public constructor() {
    super("You are not allowed to do this with the page.");
    this.name = "WikiAccessDeniedError";
  }
}

/** Thrown when somebody else saved the page after the actor loaded it. */
export class WikiConflictError extends Error {
  /** The saved page, so the client can offer to keep, take or compare. */
  public readonly current: WikiPage;

  /**
   * Creates the error.
   *
   * @param current - Page as it is stored now.
   */
  public constructor(current: WikiPage) {
    super("The page was changed by somebody else in the meantime.");
    this.name = "WikiConflictError";
    this.current = current;
  }
}
