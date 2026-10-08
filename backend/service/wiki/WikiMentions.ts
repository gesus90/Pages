import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";

const MENTION_PATTERN = /(?:^|[\s(])@([^\s@()[\]<>,;:!?"']+)/gu;
const TRAILING_PUNCTUATION = /[.\-_]+$/u;

/**
 * Reads the people a text mentions with `@user name`.
 *
 * @param text - Page text or comment.
 * @returns The user names, each once and without the punctuation that ends a
 * sentence, in order of appearance.
 */
export function extractMentions(text: string): string[] {
  const names = new Set<string>();

  for (const [, raw = ""] of text.matchAll(MENTION_PATTERN)) {
    const name = raw.replace(TRAILING_PUNCTUATION, "");

    if (name !== "") {
      names.add(name);
    }
  }

  return [...names];
}

/** What a mention record belongs to. */
export interface MentionSource {
  readonly pageId: string;
  /** The comment, or an empty text for the page itself. */
  readonly commentId: string;
  /** Who wrote the text. */
  readonly authorId: string;
  readonly text: string;
}

/**
 * Stores who a text mentions, keeping the records of people that were
 * mentioned before so that nothing becomes unread again.
 *
 * @param repository - Wiki persistence, usually bound to a transaction.
 * @param source - The text and where it belongs.
 *
 * @remarks
 * Only active accounts are recorded; whether a mentioned person may see the
 * page is decided when they open "For me", not here.
 */
export async function syncMentions(
  repository: WikiRepository,
  source: MentionSource,
): Promise<void> {
  const users = await repository.lookups.findActiveUsersByUsernames(
    extractMentions(source.text),
  );

  await repository.mentions.replace(
    source,
    users.map((user) => user.id).filter((id) => id !== source.authorId),
  );
}
