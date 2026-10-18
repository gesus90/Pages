import { useTranslation } from "react-i18next";

import type { TFunction } from "i18next";
import type {
  ChatSelectionItem,
  ChatSessionActivity,
  ChatSteerStatus,
} from "@/definition/ChatJob";

/** What the Codex path recorded about the messages of a conversation. */
export interface ChatMessageFacts {
  readonly steers: Readonly<Record<string, ChatSteerStatus>>;
  readonly selections: Readonly<Record<string, readonly ChatSelectionItem[]>>;
}

/**
 * Collects steer statuses and selection snapshots by message.
 *
 * @param activity - What the server stored for the conversation.
 * @param live - Steer statuses the running job reported since; they are newer.
 * @returns The facts of every message that has some.
 */
export function chatMessageFacts(
  activity: ChatSessionActivity | undefined,
  live: Readonly<Record<string, ChatSteerStatus>> | undefined,
): ChatMessageFacts {
  return {
    steers: {
      ...Object.fromEntries(
        (activity?.steers ?? []).map((steer) => [
          steer.messageId,
          steer.status,
        ]),
      ),
      ...live,
    },
    selections: Object.fromEntries(
      (activity?.selections ?? []).map((selection) => [
        selection.messageId,
        selection.items,
      ]),
    ),
  };
}

/** How one attachment reached the agent; a cut text names how much of it arrived (PAGE-92). */
function selectionText(t: TFunction, item: ChatSelectionItem): string {
  const { scope } = item;
  if (item.transfer !== "truncated" || scope === undefined)
    return t(`chat.selection.${item.transfer}`, { name: item.fileName });
  return t(
    scope.pages
      ? "chat.selection.truncatedPages"
      : "chat.selection.truncatedCharacters",
    {
      name: item.fileName,
      characters: scope.characters.toLocaleString(),
      read: scope.pages?.read ?? 0,
      total: scope.pages?.total ?? 0,
    },
  );
}

interface ChatMessageMetaProps {
  readonly steer: ChatSteerStatus | undefined;
  readonly selection: readonly ChatSelectionItem[] | undefined;
}

/**
 * Under an own message: whether it joined a running answer, and every selected
 * attachment that did not reach the agent completely.
 */
export function ChatMessageMeta({
  steer,
  selection,
}: ChatMessageMetaProps): React.ReactElement | null {
  const { t } = useTranslation();
  const incomplete = (selection ?? []).filter(
    (item) => item.transfer !== "full",
  );
  if (steer === undefined && incomplete.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {steer === undefined ? null : (
        <p role="status">{t(`chat.steer.${steer}`)}</p>
      )}
      {incomplete.length === 0 ? null : (
        <ul aria-label={t("chat.selection.label")}>
          {incomplete.map((item) => (
            <li key={item.attachmentId}>{selectionText(t, item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
