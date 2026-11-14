import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquareText } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { CardPanel } from "../content/card-panel";
import { CardAction } from "../content/content-card";
import { mediaCardOf } from "./media-overview-model";

import type {
  ConversationMediaFile,
  ConversationMediaTab,
} from "@/definition/ConversationMediaOverview";
import type { OpenedCard } from "../content/card-types";

interface MediaDetailProps {
  /** The files of the tab the detail pages through, in their order. */
  readonly files: readonly ConversationMediaFile[];
  readonly detailId: string;
  readonly tab: ConversationMediaTab;
  readonly senderName: (senderId: string) => string;
  readonly onSelect: (attachmentId: string | null) => void;
  readonly onToMessage: (messageId: string) => void;
  readonly onFullscreen: (card: OpenedCard) => void;
}

/** Pages with ← and → through the files of the tab while no field has the focus. */
function useDetailKeys(onStep: (step: number) => void): void {
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]"))
        return;
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowRight") onStep(1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onStep]);
}

/**
 * A document, a sound or a file of "Medien & Dateien" shown large in the
 * panel next to the chat (PAGE-387), with the way back to the list, paging
 * through the files of the tab and "Zur Nachricht".
 */
export function MediaDetail({
  files,
  detailId,
  tab,
  senderName,
  onSelect,
  onToMessage,
  onFullscreen,
}: MediaDetailProps): React.ReactElement | null {
  const { t } = useTranslation();
  const index = files.findIndex((file) => file.attachment.id === detailId);
  const file = files[index];

  function step(by: number): void {
    const next = files[index + by];
    if (next) onSelect(next.attachment.id);
  }

  useDetailKeys(step);
  if (!file) return null;
  const card = mediaCardOf(file, senderName(file.senderId));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-media-detail={detailId}>
      <nav
        aria-label={t("chatPage.media.detailLabel")}
        className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5"
      >
        <CardAction
          icon={ArrowLeft}
          label={t("chatPage.media.back", { tab: t(`chatPage.media.tabs.${tab}`) })}
          onClick={() => onSelect(null)}
          variant="quiet"
        />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {t("chatPage.media.position", { current: index + 1, total: files.length })}
        </span>
        <CardAction icon={ChevronLeft} isIconOnly label={t("chatPage.media.previous")} onClick={() => step(-1)} variant="quiet" />
        <CardAction icon={ChevronRight} isIconOnly label={t("chatPage.media.next")} onClick={() => step(1)} variant="quiet" />
        <CardAction
          icon={MessageSquareText}
          label={t("chatPage.cards.toMessage")}
          onClick={() => onToMessage(file.messageId)}
          variant="quiet"
        />
      </nav>
      <CardPanel
        key={card.key}
        card={card}
        className="min-h-0 flex-1"
        onClose={() => onSelect(null)}
        onFullscreen={() => onFullscreen(card)}
      />
    </div>
  );
}
