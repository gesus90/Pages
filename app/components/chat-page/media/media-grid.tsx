import { Clock, Film, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { isMediaExpired } from "@/definition/ConversationMediaOverview";

import { useMediaFacts } from "../content/media-facts";
import { formatSeconds } from "../content/use-media-player";
import { retentionLabel } from "../content/file-retention";
import { groupByMonth } from "./media-overview-model";

import type { ConversationMediaFile } from "@/definition/ConversationMediaOverview";
import type { MediaItemActions } from "./media-item-actions";

const BADGE_CLASS =
  "absolute rounded-md bg-viewer-control px-1.5 py-0.5 text-[11px] font-medium text-viewer-foreground tabular-nums";

/** The preview of an image or a video: its preview image, else the image itself or an icon. */
function TilePreview({
  file,
}: {
  readonly file: ConversationMediaFile;
}): React.ReactElement {
  const { attachment } = file;
  const source =
    attachment.thumbnailUrl ??
    (attachment.kind === "image" ? attachment.url : undefined);
  if (source === undefined) {
    const Icon = attachment.kind === "video" ? Film : ImageIcon;
    return <Icon aria-hidden="true" className="size-6 text-muted-foreground" />;
  }
  return (
    <img
      alt=""
      className="absolute inset-0 size-full object-cover"
      decoding="async"
      loading="lazy"
      src={source}
    />
  );
}

/** The length of a video bottom right of its tile. */
function VideoLength({
  file,
}: {
  readonly file: ConversationMediaFile;
}): React.ReactElement | null {
  const facts = useMediaFacts(file.attachment);
  if (file.attachment.kind !== "video" || facts.durationSeconds === undefined)
    return null;
  return (
    <span
      className={`${BADGE_CLASS} right-1.5 bottom-1.5`}
      data-media-length=""
    >
      {formatSeconds(facts.durationSeconds)}
    </span>
  );
}

/** One image or video of the grid: open on click, mark with its box, remaining time of a file of an agent. */
function MediaTile({
  file,
  actions,
}: {
  readonly file: ConversationMediaFile;
  readonly actions: MediaItemActions;
}): React.ReactElement {
  const { t } = useTranslation();
  const { attachment } = file;
  const { now } = actions;
  if (now !== null && isMediaExpired(attachment, now))
    return (
      <li
        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/40 p-2 text-center text-[11px] text-muted-foreground"
        data-media-expired={attachment.id}
        title={attachment.name}
      >
        <Clock aria-hidden="true" className="size-4" />
        {t("chatPage.media.expired")}
      </li>
    );
  const retention =
    now === null ? null : retentionLabel(attachment.expiresAt, now, t);
  const isSelected = actions.selected.has(attachment.id);
  return (
    <li className="relative" data-media-tile={attachment.id}>
      <button
        aria-label={attachment.name}
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-panel-body focus-visible:outline-2 focus-visible:outline-primary data-[selected=true]:ring-2 data-[selected=true]:ring-primary"
        data-selected={isSelected}
        onClick={() => actions.open(file)}
        title={attachment.name}
        type="button"
      >
        <TilePreview file={file} />
        <VideoLength file={file} />
        {retention === null ? null : (
          <span className={`${BADGE_CLASS} bottom-1.5 left-1.5`}>
            {retention}
          </span>
        )}
      </button>
      <span className="absolute top-1.5 left-1.5 rounded-md bg-surface/80 p-0.5">
        <Checkbox
          aria-label={t("chatPage.media.mark", { name: attachment.name })}
          checked={isSelected}
          onChange={() => actions.toggleSelected(attachment.id)}
        />
      </span>
    </li>
  );
}

/**
 * Images or videos as a grid of preview images, newest first, grouped by
 * month; a video shows its length.
 */
export function MediaGrid({
  files,
  actions,
}: {
  readonly files: readonly ConversationMediaFile[];
  readonly actions: MediaItemActions;
}): React.ReactElement {
  const { i18n } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-3">
      {groupByMonth(files, i18n.language).map((group) => (
        <section
          key={group.key}
          aria-label={group.label}
          data-media-month={group.key}
        >
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
            {group.label}
          </h3>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 2xl:grid-cols-5">
            {group.files.map((file) => (
              <MediaTile
                key={file.attachment.id}
                actions={actions}
                file={file}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
