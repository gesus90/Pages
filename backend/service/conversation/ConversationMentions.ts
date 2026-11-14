import { CONVERSATION_ALL_ALIASES } from "@/definition/ConversationMention";
import type { ConversationMentionAlias } from "@/definition/ConversationMention";
import type { ConversationAccounts } from "./ConversationDirectory";

const MENTION = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}._-]{1,100})/gu;

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

function collectiveTargets(
  written: string,
  memberIds: readonly string[],
  visible: readonly ConversationMentionAlias[],
): readonly string[] | null {
  const trimmed = written.replace(/[._-]+$/u, "");
  if (CONVERSATION_ALL_ALIASES.includes(trimmed)) return memberIds;
  const matching = visible.filter(
    (alias) => alias.name === written || alias.name === trimmed,
  );
  return matching.length > 0
    ? matching.flatMap((alias) => alias.memberIds)
    : null;
}

function addAgentMentions(
  targets: readonly string[],
  memberIds: readonly string[],
  context: MentionContext,
  mentioned: Set<string>,
): void {
  for (const target of targets) {
    const account = context.accounts.find(target);
    if (
      target !== context.senderId &&
      memberIds.includes(target) &&
      account?.user.isAgent === true &&
      account.isAvailable
    )
      mentioned.add(target);
  }
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
  const visibleAliases = context.accounts.aliasesFor(context.senderId);
  for (const match of text.matchAll(MENTION)) {
    const written = (match[1] ?? "").toLowerCase();
    // A sentence may end right after the name, as in "Danke @Lena.".
    const trimmed = written.replace(/[._-]+$/u, "");
    const targets = collectiveTargets(written, memberIds, visibleAliases);
    if (targets !== null) {
      addAgentMentions(targets, memberIds, context, mentioned);
      continue;
    }
    const id =
      usernames.get(written) ??
      usernames.get(trimmed) ??
      aliases.get(written) ??
      aliases.get(trimmed);
    if (typeof id === "string") mentioned.add(id);
  }
  return [...mentioned];
}
