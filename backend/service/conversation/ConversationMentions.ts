import type { ConversationAccounts } from "./ConversationDirectory";

const MENTION = /(?<![\w@])@([\p{L}\p{N}._-]{1,100})/gu;

/** The sender and the accounts that name the members. */
interface MentionContext {
  readonly accounts: ConversationAccounts;
  readonly senderId: string;
}

/** The names that address a member besides the username: the display name without spaces and its first word. */
function aliasesOf(displayName: string): string[] {
  const words = displayName.trim().split(/\s+/u);
  return [words.join(""), words[0] ?? ""].filter((alias) => alias !== "");
}

/** Every name of the members, lower case; an alias two members share addresses nobody. */
function namesOf(
  memberIds: readonly string[],
  context: MentionContext,
): {
  readonly usernames: ReadonlyMap<string, string>;
  readonly aliases: ReadonlyMap<string, string | null>;
} {
  const usernames = new Map<string, string>();
  const aliases = new Map<string, string | null>();
  for (const id of memberIds) {
    if (id === context.senderId) continue;
    const account = context.accounts.find(id);
    if (!account) continue;
    usernames.set(account.user.username.toLowerCase(), id);
    for (const alias of new Set(
      aliasesOf(account.user.displayName).map((name) => name.toLowerCase()),
    )) {
      const known = aliases.get(alias);
      aliases.set(alias, known === undefined || known === id ? id : null);
    }
  }
  return { usernames, aliases };
}

/**
 * The members a text names with `@Name`, never the sender (PAGE-278, PAGE-276).
 *
 * @param text - The text of the message.
 * @param memberIds - The members of the conversation.
 * @param context - The sender and the accounts that name the members.
 * @returns Each mentioned member once, in the order of the first mention.
 *
 * @remarks
 * `@username` always names its account. The display name without spaces and
 * its first word, such as `@Lena` for Lena Berg, name a member as well, as
 * long as no other member of the conversation carries the same one.
 */
export function findConversationMentions(
  text: string,
  memberIds: readonly string[],
  context: MentionContext,
): string[] {
  const { usernames, aliases } = namesOf(memberIds, context);
  const mentioned = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const written = (match[1] ?? "").toLowerCase();
    // A sentence may end right after the name, as in "Danke @Lena.".
    const trimmed = written.replace(/[._-]+$/u, "");
    const id =
      usernames.get(written) ??
      usernames.get(trimmed) ??
      aliases.get(written) ??
      aliases.get(trimmed);
    if (typeof id === "string") mentioned.add(id);
  }
  return [...mentioned];
}
