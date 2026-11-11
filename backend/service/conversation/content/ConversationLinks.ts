import { Readable } from "node:stream";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { conversationEmbedDomainSchema } from "@/definition/ConversationContent";

import type { ReadStream } from "node:fs";
import type { ConversationEmbedDomainRepository } from "@/backend/database/repositories/conversation/ConversationEmbedDomainRepository";
import type {
  ConversationLinkPreviewRepository,
  StoredLinkPreview,
} from "@/backend/database/repositories/conversation/ConversationLinkPreviewRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationLinkFetcher } from "@/backend/service/conversation/links/ConversationLinkFetcher";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ChatEmbedDomains,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { User } from "@/definition/User";

const COMPONENT = "ConversationLinks";
/** How long the preview data of a URL counts. */
const PREVIEW_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
/** Link cards one message shows at most. */
const MAXIMUM_LINKS_PER_MESSAGE = 10;
const MAXIMUM_URL_LENGTH = 2_000;
const FENCE = /^\s*(```|~~~)/u;
/** Local previews embed with any port. */
const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the links of conversations use. */
export interface ConversationLinksDependencies {
  readonly previews: ConversationLinkPreviewRepository;
  readonly domains: ConversationEmbedDomainRepository;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  /** The replaceable fetch of preview data, so it can be reproduced offline. */
  readonly fetcher: ConversationLinkFetcher;
  /** The preview images of linked pages. */
  readonly files: Pick<WikiFileStore, "write" | "open" | "remove" | "sweep">;
  /** Tells the live view that a conversation shows new preview data. */
  readonly publisher: { publish(event: PagesEvent): void };
  /** The host names Pages itself is reached under; they always embed. */
  readonly ownHosts?: () => readonly string[];
  readonly now?: () => Date;
}

/** A message whose links are read. */
export interface LinkedMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly text: string;
}

/** The preview image of a linked page, opened for a signed-in account. */
export interface OpenedLinkImage {
  readonly mimeType: string;
  readonly stream: ReadStream;
}

/**
 * Reads a line that consists of one `http` or `https` URL.
 *
 * @param line - One line of a message.
 * @returns The normalized URL, or `null` for every other line.
 */
export function readLinkLine(line: string): string | null {
  // The editor writes a bare address as an autolink in angle brackets.
  const candidate = line.trim().replace(/^<(.*)>$/u, "$1");
  if (
    candidate.length > MAXIMUM_URL_LENGTH ||
    !/^https?:\/\/\S+$/iu.test(candidate)
  )
    return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.hostname === "")
    return null;
  return url.href;
}

/**
 * Finds the URLs that stand alone in a line of a message, outside code blocks.
 *
 * @param text - The text of the message.
 * @returns The distinct URLs in their order, ten at most.
 */
export function findLinkUrls(text: string): string[] {
  const urls: string[] = [];
  let isCode = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      isCode = !isCode;
      continue;
    }
    const url = isCode ? null : readLinkLine(line);
    if (url !== null && !urls.includes(url)) urls.push(url);
    if (urls.length >= MAXIMUM_LINKS_PER_MESSAGE) break;
  }
  return urls;
}

/** The address a client loads the stored preview image of a URL from. */
export function conversationLinkImageUrl(url: string): string {
  return `/chat/link-image?url=${encodeURIComponent(url)}`;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/**
 * The links of conversation messages (PAGE-298): their preview data and
 * which of them may be embedded.
 *
 * @remarks
 * A URL alone in a line becomes a link. Embedded are only Pages itself,
 * local previews on `127.0.0.1` or `localhost` with any port, the domains an
 * administrator released for every conversation, and the domains a member
 * released for the conversation. Every other link shows as a card with the
 * preview data the server fetched once per URL and keeps for 24 hours: the
 * fetch runs after the read, outside the request, and the live view learns
 * of its result. A page that gave no answer is remembered as well, so the
 * card shows the domain alone and the page is not asked again within the
 * day. The preview image lies in the file store of Pages; no client
 * contacts the linked site for it.
 */
export class ConversationLinks {
  private readonly dependencies: ConversationLinksDependencies;
  private readonly fetching = new Set<string>();

  public constructor(dependencies: ConversationLinksDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the links of messages with the preview data the server has.
   *
   * @param messages - The messages with their conversations.
   * @returns The links by message ID; messages without one have no entry.
   */
  public async forMessages(
    messages: readonly LinkedMessage[],
  ): Promise<Map<string, ConversationLink[]>> {
    const found = messages
      .map((message) => ({ message, urls: findLinkUrls(message.text) }))
      .filter((entry) => entry.urls.length > 0);
    const links = new Map<string, ConversationLink[]>();
    if (found.length === 0) return links;
    const urls = [...new Set(found.flatMap((entry) => entry.urls))];
    const conversationIds = [
      ...new Set(found.map((entry) => entry.message.conversationId)),
    ];
    const [previews, released] = await Promise.all([
      this.dependencies.previews.find(urls),
      this.embedDomains(conversationIds),
    ]);
    const stale = new Map<string, Set<string>>();
    for (const { message, urls: messageUrls } of found) {
      const allowed = new Set([
        ...released.global,
        ...(released.byConversation[message.conversationId] ?? []),
      ]);
      links.set(
        message.id,
        messageUrls.map((url) => {
          const preview = previews.get(url);
          if (!preview || this.isExpired(preview)) {
            const waiting = stale.get(url) ?? new Set<string>();
            waiting.add(message.conversationId);
            stale.set(url, waiting);
          }
          return this.toLink(url, preview, allowed);
        }),
      );
    }
    this.refreshLater(stale);
    return links;
  }

  /**
   * Reads the released domains of conversations and those released for all.
   *
   * @param conversationIds - The conversations the caller may read.
   */
  public async embedDomains(
    conversationIds: readonly string[],
  ): Promise<ChatEmbedDomains> {
    const [global, byConversation] = await Promise.all([
      this.dependencies.domains.global(),
      this.dependencies.domains.forConversations(conversationIds),
    ]);
    return { global, byConversation: Object.fromEntries(byConversation) };
  }

  /**
   * Tells whether a URL may be embedded for a person: in a conversation of
   * which the person is a member, or outside of any with what holds
   * everywhere.
   *
   * @param person - The signed-in account.
   * @param target - The URL and, when it stands in one, the conversation.
   */
  public async isEmbeddable(
    person: User,
    target: {
      readonly url: string;
      readonly conversationId: string | null;
      /** The host the request reached Pages under; it is Pages itself. */
      readonly requestHost?: string;
    },
  ): Promise<boolean> {
    const url = readLinkLine(target.url);
    if (url === null) return false;
    const host = hostOf(url);
    if (this.isAlwaysEmbeddable(host) || host === target.requestHost)
      return true;
    const { conversationId } = target;
    const isMember =
      conversationId !== null &&
      IDENTIFIER.test(conversationId) &&
      (await this.dependencies.conversations.findForMember(
        conversationId,
        person.id,
      )) !== null;
    const released = await this.embedDomains(
      isMember && conversationId !== null ? [conversationId] : [],
    );
    return [
      ...released.global,
      ...Object.values(released.byConversation).flat(),
    ].includes(host);
  }

  /**
   * Releases a domain for a conversation, or takes the release back; every
   * member may do both.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for anything that is no host name.
   */
  public async setReleased(
    person: User,
    change: {
      readonly conversationId: unknown;
      readonly domain: unknown;
      readonly isReleased: boolean;
    },
  ): Promise<void> {
    const { conversationId } = change;
    const domain = conversationEmbedDomainSchema.safeParse(change.domain);
    if (!domain.success) throw new ConversationError("invalid");
    const record =
      typeof conversationId === "string" && IDENTIFIER.test(conversationId)
        ? await this.dependencies.conversations.findForMember(
            conversationId,
            person.id,
          )
        : null;
    if (!record) throw new ConversationError("not_found");
    if (change.isReleased)
      await this.dependencies.domains.add(record.id, {
        domain: domain.data,
        addedBy: person.id,
        createdAt: this.now().toISOString(),
      });
    else await this.dependencies.domains.remove(record.id, domain.data);
    this.dependencies.publisher.publish({
      type: "conversation.changed",
      id: record.id,
    });
  }

  /** Returns the domains an administrator released for every conversation. */
  public globalDomains(): Promise<string[]> {
    return this.dependencies.domains.global();
  }

  /**
   * Releases a domain for every conversation, or takes the release back.
   * The caller checks that the person administers Pages.
   *
   * @throws {ConversationError} `invalid` for anything that is no host name.
   */
  public async setGloballyReleased(
    person: User,
    change: { readonly domain: unknown; readonly isReleased: boolean },
  ): Promise<void> {
    const domain = conversationEmbedDomainSchema.safeParse(change.domain);
    if (!domain.success) throw new ConversationError("invalid");
    if (change.isReleased)
      await this.dependencies.domains.addGlobal({
        domain: domain.data,
        addedBy: person.id,
        createdAt: this.now().toISOString(),
      });
    else await this.dependencies.domains.removeGlobal(domain.data);
  }

  /**
   * Opens the stored preview image of a URL.
   *
   * @throws {ConversationError} `not_found` without a stored image.
   */
  public async openImage(url: unknown): Promise<OpenedLinkImage> {
    if (typeof url !== "string" || url.length > MAXIMUM_URL_LENGTH)
      throw new ConversationError("not_found");
    const preview = (await this.dependencies.previews.find([url])).get(url);
    if (!preview?.image) throw new ConversationError("not_found");
    return {
      mimeType: preview.image.mimeType,
      stream: this.dependencies.files.open(preview.image.storageName),
    };
  }

  /** Removes preview data older than a day and images nothing lists any more. */
  public async sweep(): Promise<void> {
    const expired = new Date(
      this.now().getTime() - PREVIEW_LIFETIME_MILLISECONDS,
    ).toISOString();
    await this.dependencies.files.remove(
      await this.dependencies.previews.removeBefore(expired),
    );
    await this.dependencies.files.sweep(
      await this.dependencies.previews.storageNames(),
      PREVIEW_LIFETIME_MILLISECONDS,
    );
  }

  /**
   * Fetches the preview data of one URL and stores what came of it.
   *
   * @param url - A URL {@link findLinkUrls} returned.
   */
  public async refresh(url: string): Promise<void> {
    const fetched = await this.dependencies.fetcher.fetch(url);
    const image =
      fetched?.imageUrl === null || fetched?.imageUrl === undefined
        ? null
        : await this.dependencies.fetcher.fetchImage(fetched.imageUrl);
    const stored = image
      ? await this.dependencies.files.write(Readable.from([image.bytes]), {
          absoluteLimit: image.bytes.length,
          limitFor: () => image.bytes.length,
        })
      : null;
    const replaced = await this.dependencies.previews.save({
      url,
      title: fetched?.title ?? "",
      description: fetched?.description ?? "",
      image:
        image && stored
          ? { storageName: stored.storageName, mimeType: image.mimeType }
          : null,
      fetchedAt: this.now().toISOString(),
    });
    if (replaced !== null) await this.dependencies.files.remove([replaced]);
  }

  private toLink(
    url: string,
    preview: StoredLinkPreview | undefined,
    allowed: ReadonlySet<string>,
  ): ConversationLink {
    const domain = hostOf(url);
    return {
      url,
      domain,
      title: preview?.title ?? "",
      description: preview?.description ?? "",
      imageUrl: preview?.image ? conversationLinkImageUrl(url) : null,
      embeddable: this.isAlwaysEmbeddable(domain) || allowed.has(domain),
    };
  }

  private isAlwaysEmbeddable(host: string): boolean {
    return (
      LOCAL_HOSTS.includes(host) ||
      (this.dependencies.ownHosts?.() ?? []).includes(host)
    );
  }

  private isExpired(preview: StoredLinkPreview): boolean {
    return (
      Date.parse(preview.fetchedAt) + PREVIEW_LIFETIME_MILLISECONDS <
      this.now().getTime()
    );
  }

  /** Fetches missing preview data outside the request; each URL once at a time. */
  private refreshLater(stale: ReadonlyMap<string, ReadonlySet<string>>): void {
    for (const [url, conversationIds] of stale) {
      // Local addresses are never fetched and embed anyway.
      if (this.fetching.has(url) || this.isAlwaysEmbeddable(hostOf(url)))
        continue;
      this.fetching.add(url);
      void withBackgroundDatabaseWork("conversation_link_preview", () =>
        this.refresh(url),
      )
        .then(() => {
          for (const id of conversationIds)
            this.dependencies.publisher.publish({
              type: "conversation.changed",
              id,
            });
        })
        .catch((error: unknown) => {
          logCaughtError(COMPONENT, error);
        })
        .finally(() => {
          this.fetching.delete(url);
        });
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
