import type {
  AgentLogbookChatOption,
  AgentLogbookEntryView,
  AgentLogbookKind,
  AgentLogbookSource,
} from "@/definition/AgentLogbook";
import type { TFunction } from "i18next";

/** The value of the filters that keep every entry. */
export const ALL_ENTRIES = "all";

/** What narrows the list of entries. */
export interface AgentLogbookFilter {
  /** Words that must all appear in the text, topic, chat or people of an entry. */
  readonly query: string;
  readonly kind: AgentLogbookKind | typeof ALL_ENTRIES;
  /** The `chatKey` of a chat, or {@link ALL_ENTRIES}. */
  readonly chat: string;
}

/**
 * The key of a chat in the filter: its kind and ID.
 *
 * @param source - The chat.
 */
export function logbookChatKey(
  source: Pick<AgentLogbookSource, "kind" | "id">,
): string {
  return `${source.kind}:${source.id}`;
}

/**
 * A chat as the Lagebuch names it: "Gruppe „Name“" or "Direkt · Name".
 *
 * @param source - The chat of an entry.
 * @param t - The translation function.
 */
export function logbookChatName(
  source: Pick<AgentLogbookChatOption, "kind" | "name">,
  t: TFunction,
): string {
  return t(`agentSessions.chat.${source.kind}`, { name: source.name });
}

/**
 * The entries that match a search and the filters by kind and chat.
 *
 * @param entries - The entries, in the order to keep.
 * @param filter - Search words, kind and chat.
 */
export function filterLogbookEntries(
  entries: readonly AgentLogbookEntryView[],
  filter: AgentLogbookFilter,
): AgentLogbookEntryView[] {
  const words = filter.query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  return entries.filter((entry) => {
    if (filter.kind !== ALL_ENTRIES && entry.kind !== filter.kind) return false;
    if (
      filter.chat !== ALL_ENTRIES &&
      logbookChatKey(entry.source) !== filter.chat
    )
      return false;
    const haystack = [
      entry.text,
      entry.topic,
      entry.source.name,
      ...entry.participants,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
