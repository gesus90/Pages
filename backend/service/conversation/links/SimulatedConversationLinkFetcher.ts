import {
  MAXIMUM_LINK_DESCRIPTION_LENGTH,
  MAXIMUM_LINK_TITLE_LENGTH,
} from "./ConversationLinkFetcher";

import type {
  ConversationLinkFetcher,
  ConversationLinkImage,
  ConversationLinkPreview,
} from "./ConversationLinkFetcher";

function simulatePreview(url: string): ConversationLinkPreview | null {
  if (!URL.canParse(url)) return null;
  const target = new URL(url);
  const isWeb = target.protocol === "http:" || target.protocol === "https:";
  if (!isWeb || target.hostname.endsWith(".invalid")) return null;
  return {
    title: `Vorschau von ${target.host}`.slice(0, MAXIMUM_LINK_TITLE_LENGTH),
    description: `Simulierte Vorschau der Seite ${target.pathname}`.slice(
      0,
      MAXIMUM_LINK_DESCRIPTION_LENGTH,
    ),
    imageUrl: null,
  };
}

/**
 * Answers link previews from the URL alone, without any network contact.
 *
 * @remarks
 * The same URL always gives the same preview, so link cards can be
 * reproduced without internet. Hosts ending in `.invalid` have no preview.
 */
export class SimulatedConversationLinkFetcher implements ConversationLinkFetcher {
  /**
   * Derives the preview of a page from its address.
   *
   * @param url - Address a chat message links to.
   * @returns The preview, or `null` for `.invalid` hosts and for anything but an http(s) address.
   */
  public fetch(url: string): Promise<ConversationLinkPreview | null> {
    return Promise.resolve(simulatePreview(url));
  }

  /**
   * Simulated previews carry no image.
   *
   * @returns Always `null`.
   */
  public fetchImage(): Promise<ConversationLinkImage | null> {
    return Promise.resolve(null);
  }
}
