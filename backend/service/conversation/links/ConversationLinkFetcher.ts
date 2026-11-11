/** Longest title of a link card, in characters. */
export const MAXIMUM_LINK_TITLE_LENGTH = 300;

/** Longest description of a link card, in characters. */
export const MAXIMUM_LINK_DESCRIPTION_LENGTH = 500;

/** Longest image address of a link card, in characters. */
export const MAXIMUM_LINK_IMAGE_URL_LENGTH = 2000;

/** What the server learned about a page for a link card. */
export interface ConversationLinkPreview {
  /** Title of the page; `""` when unknown, at most 300 characters. */
  readonly title: string;
  /** Description of the page; `""` when unknown, at most 500 characters. */
  readonly description: string;
  /**
   * Absolute http(s) address of `og:image`, resolved against the final URL;
   * `null` when absent or not http(s). At most 2,000 characters.
   */
  readonly imageUrl: string | null;
}

/** The image types a link card may show. */
export type ConversationLinkImageMimeType =
  "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";

/** A preview image the server loaded, so browsers never contact the foreign site. */
export interface ConversationLinkImage {
  /** The complete image, never a truncated one. */
  readonly bytes: Uint8Array;
  /** The type the foreign server declared, without parameters. */
  readonly mimeType: ConversationLinkImageMimeType;
}

/** The replaceable dependency that fetches the preview data of one URL. */
export interface ConversationLinkFetcher {
  /**
   * Fetches the preview data of one page.
   *
   * @param url - Address a chat message links to; untrusted.
   * @returns The preview, or `null` without an answer. Never throws.
   */
  fetch(url: string): Promise<ConversationLinkPreview | null>;

  /**
   * Fetches the preview image of a link card.
   *
   * @param url - Address of the image, as in {@link ConversationLinkPreview.imageUrl}; untrusted.
   * @returns The image, or `null` without an answer. Never throws.
   */
  fetchImage(url: string): Promise<ConversationLinkImage | null>;
}
