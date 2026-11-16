import { FolderOpen, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  CONVERSATION_MEDIA_ARCHIVE_MAXIMUM,
  filterMediaFiles,
  filterMediaLinks,
  mediaArchiveUrl,
  mediaTabCounts,
} from "@/definition/ConversationMediaOverview";

import { useChatContent } from "../content/chat-content-context";
import {
  CardAction,
  CardActionDivider,
  CardDownloadAction,
  CardHead,
} from "../content/content-card";
import { useNow } from "../content/use-now";
import { useMediaOverview } from "./media-overview-api";
import { MediaDetail } from "./media-detail";
import { MediaGrid } from "./media-grid";
import { MediaLinks } from "./media-links";
import {
  mediaCardOf,
  mediaImageOf,
  senderNameOf,
} from "./media-overview-model";
import { MediaFilters, MediaTabs } from "./media-overview-toolbar";
import { MediaRows } from "./media-rows";
import { useMediaOverviewState } from "./use-media-overview-state";

import type {
  ConversationMediaFile,
  ConversationMediaLink,
  ConversationMediaOverview,
} from "@/definition/ConversationMediaOverview";
import type { ChatContent } from "../content/chat-content-context";
import type { MediaItemActions } from "./media-item-actions";
import type { MediaOverviewState } from "./use-media-overview-state";

/** What the overview shows after the search and the filters. */
interface ShownMedia {
  readonly files: readonly ConversationMediaFile[];
  readonly links: readonly ConversationMediaLink[];
  /** The files of the open tab. */
  readonly tabFiles: readonly ConversationMediaFile[];
}

function shownMediaOf(
  overview: ConversationMediaOverview | null,
  state: MediaOverviewState,
  now: number | null,
): ShownMedia {
  const files = overview
    ? filterMediaFiles(overview.files, state.filter, now ?? 0)
    : [];
  const links = overview ? filterMediaLinks(overview.links, state.filter) : [];
  return {
    files,
    links,
    tabFiles: files.filter((file) => file.tab === state.tab),
  };
}

/** Opens a file in its view: images in the viewer, videos in their full screen, the rest large in the panel. */
function itemActionsOf(
  content: ChatContent,
  shown: ShownMedia,
  context: {
    readonly overview: ConversationMediaOverview | null;
    readonly state: MediaOverviewState;
    readonly now: number | null;
  },
): MediaItemActions {
  const { overview, state, now } = context;
  const senderName = (senderId: string): string =>
    senderNameOf(overview?.senders ?? [], senderId);
  return {
    selected: state.selected,
    toggleSelected: state.toggleSelected,
    now,
    senderName,
    toMessage: (messageId) => {
      if (content.media === "overlay") content.closeMedia();
      content.revealMessage(messageId);
    },
    open: (file) => {
      const name = senderName(file.senderId);
      if (file.tab === "images") {
        content.openViewer({
          attachmentId: file.attachment.id,
          images: shown.tabFiles.map((entry) =>
            mediaImageOf(entry, senderName(entry.senderId)),
          ),
        });
        return;
      }
      if (file.tab === "videos") {
        content.openOverlay(mediaCardOf(file, name));
        return;
      }
      state.openDetail(file.attachment.id);
    },
  };
}

/** The head: name, count, the ZIP of the marked files, reload and close. */
function OverviewHead({
  conversationId,
  total,
  state,
  onReload,
  onClose,
}: {
  readonly conversationId: string | null;
  readonly total: number;
  readonly state: MediaOverviewState;
  readonly onReload: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const marked = [...state.selected];
  const canArchive =
    conversationId !== null &&
    marked.length > 0 &&
    marked.length <= CONVERSATION_MEDIA_ARCHIVE_MAXIMUM;
  return (
    <CardHead
      actions={
        <>
          {marked.length > 0 ? (
            <CardAction
              label={t("chatPage.media.clearSelection")}
              onClick={state.clearSelected}
              variant="quiet"
            />
          ) : null}
          {canArchive ? (
            <CardDownloadAction
              download={{
                href: mediaArchiveUrl(conversationId, marked),
                label: t("chatPage.media.downloadZip", {
                  count: marked.length,
                }),
              }}
            />
          ) : null}
          <CardActionDivider />
          <CardAction
            icon={RotateCw}
            isIconOnly
            label={t("chatPage.media.reload")}
            onClick={onReload}
            variant="quiet"
          />
          <CardAction
            icon={X}
            isIconOnly
            label={t("chatPage.cards.close")}
            onClick={onClose}
            variant="quiet"
          />
        </>
      }
      className="border-b border-border px-4"
      icon={FolderOpen}
      name={t("chatPage.media.title")}
      subtitle={
        marked.length > 0
          ? t("chatPage.media.selected", { count: marked.length })
          : t("chatPage.media.subtitle", { count: total })
      }
    />
  );
}

/** Why a tab shows nothing: it failed, is on its way, or is empty. */
function emptyKey(status: {
  readonly isLoading: boolean;
  readonly isFailed: boolean;
}): string {
  if (status.isFailed) return "failed";
  return status.isLoading ? "loading" : "empty";
}

/** The content of the open tab, or why there is none. */
function TabBody({
  shown,
  state,
  actions,
  status,
}: {
  readonly shown: ShownMedia;
  readonly state: MediaOverviewState;
  readonly actions: MediaItemActions;
  readonly status: { readonly isLoading: boolean; readonly isFailed: boolean };
}): React.ReactElement {
  const { t } = useTranslation();
  const isEmpty =
    state.tab === "links"
      ? shown.links.length === 0
      : shown.tabFiles.length === 0;
  if (isEmpty) {
    return (
      <p
        className="p-6 text-center text-sm text-muted-foreground"
        role="status"
      >
        {t(`chatPage.media.${emptyKey(status)}`)}
      </p>
    );
  }
  if (state.tab === "links")
    return <MediaLinks actions={actions} links={shown.links} />;
  if (state.tab === "images" || state.tab === "videos")
    return <MediaGrid actions={actions} files={shown.tabFiles} />;
  return <MediaRows actions={actions} files={shown.tabFiles} />;
}

/**
 * "Medien & Dateien" of the opened chat: tabs for images, videos,
 * sound, documents, files and links with their counts, search by name,
 * filter by sender, "läuft bald ab" and hiding expired files; marked files
 * download as one ZIP archive.
 *
 * @remarks
 * It stands next to the chat like an opened card, and covers the page on a
 * narrow screen. Images open in the image viewer, videos in their full
 * screen, both paging through the chat; documents, sounds and files open
 * large in the panel and page through their tab. "Zur Nachricht" scrolls the
 * history to the message, loading older pages when needed.
 */
export function MediaOverviewPanel({
  className,
  style,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const [reloads, setReloads] = useState(0);
  const loaded = useMediaOverview(content.conversationId, String(reloads));
  const now = useNow();
  const state = useMediaOverviewState();
  const { overview } = loaded;
  const shown = shownMediaOf(overview, state, now);
  const actions = itemActionsOf(content, shown, { overview, state, now });
  const total = overview ? overview.files.length + overview.links.length : 0;
  return (
    <section
      aria-label={t("chatPage.media.title")}
      className={cn(
        "@container flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-foreground",
        className,
      )}
      data-media-overview=""
      style={style}
    >
      <OverviewHead
        conversationId={content.conversationId}
        onClose={content.closeMedia}
        onReload={() => setReloads((count) => count + 1)}
        state={state}
        total={total}
      />
      {state.detailId === null ? (
        <>
          <MediaTabs
            counts={mediaTabCounts(shown.files, shown.links)}
            state={state}
          />
          <MediaFilters senders={overview?.senders ?? []} state={state} />
          <div
            className="min-h-0 flex-1 overflow-y-auto border-t border-border bg-panel-body"
            role="tabpanel"
          >
            <TabBody
              actions={actions}
              shown={shown}
              state={state}
              status={loaded}
            />
          </div>
        </>
      ) : (
        <MediaDetail
          detailId={state.detailId}
          files={shown.tabFiles}
          onFullscreen={content.openOverlay}
          onSelect={state.openDetail}
          onToMessage={actions.toMessage}
          senderName={actions.senderName}
          tab={state.tab}
        />
      )}
    </section>
  );
}

/** "Medien & Dateien" over the page on a narrow screen. */
export function MediaOverviewOverlay(): React.ReactElement | null {
  const { t } = useTranslation();
  const { media } = useChatContent();
  if (media !== "overlay") return null;
  return (
    <div
      aria-label={t("chatPage.media.title")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-scrim-drawer"
      role="dialog"
    >
      <MediaOverviewPanel className="flex-1" />
    </div>
  );
}
