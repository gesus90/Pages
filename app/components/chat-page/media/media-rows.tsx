import {
  Clock,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  MessageSquareText,
  Music,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/lib/cn";
import { isMediaExpired } from "@/definition/ConversationMediaOverview";

import { fileEndingOf } from "../content/binary-file-row";
import { downloadUrl, formatFileSize } from "../content/card-types";
import { CardAction, CardDownloadAction } from "../content/content-card";
import { documentFormatOf } from "../content/documents/document-kinds";
import { retentionLabel } from "../content/file-retention";
import { useMediaFacts } from "../content/media-facts";
import { formatSeconds } from "../content/use-media-player";
import { formatSentAt } from "./media-item-actions";

import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import type { ConversationMediaFile } from "@/definition/ConversationMediaOverview";
import type { MediaItemActions } from "./media-item-actions";

/**
 * The fixed columns of a row: box, icon, name with kind and size,
 * sender and date, remaining time, actions. Every row uses the same widths,
 * so rows below each other line up; in a narrow panel sender and date move
 * below the name.
 */
const ROW_COLUMNS =
  "grid-cols-[1.25rem_2rem_minmax(0,1fr)_auto] @xl:grid-cols-[1.25rem_2rem_minmax(0,1fr)_11rem_6.5rem_auto]";

function iconOf(file: ConversationMediaFile): LucideIcon {
  if (file.tab === "audio") return Music;
  if (file.tab === "files") return FileIcon;
  const format = documentFormatOf(file.attachment);
  return format === "xlsx" ||
    format === "ods" ||
    format === "csv" ||
    format === "tsv"
    ? FileSpreadsheet
    : FileText;
}

/** Kind, size and, for a sound, its length. */
function useKindAndSize(
  file: ConversationMediaFile,
  t: TFunction,
  language: string,
): string {
  const facts = useMediaFacts(file.attachment);
  const { attachment } = file;
  return [
    fileEndingOf(attachment.name) ||
      t(`chatPage.cards.kind.${attachment.kind}`),
    file.tab === "audio" && facts.durationSeconds !== undefined
      ? formatSeconds(facts.durationSeconds)
      : null,
    formatFileSize(attachment.sizeBytes, language),
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
}

/** The remaining time of a file of an agent, "abgelaufen" for one that is gone. */
function Retention({
  file,
  now,
}: {
  readonly file: ConversationMediaFile;
  readonly now: number | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (now === null) return null;
  if (isMediaExpired(file.attachment, now))
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatPage.media.expired")}
      </span>
    );
  const label = retentionLabel(file.attachment.expiresAt, now, t);
  return label === null ? null : (
    <span className="text-xs font-medium text-primary" data-media-retention="">
      {label}
    </span>
  );
}

/** One sound, document or file as a row of the unified card design. */
function MediaRow({
  file,
  actions,
}: {
  readonly file: ConversationMediaFile;
  readonly actions: MediaItemActions;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { attachment } = file;
  const isExpired =
    actions.now !== null && isMediaExpired(attachment, actions.now);
  const Icon = isExpired ? Clock : iconOf(file);
  const meta = useKindAndSize(file, t, i18n.language);
  const origin = [
    actions.senderName(file.senderId),
    formatSentAt(file.sentAt, i18n.language),
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <li
      className={cn(
        "grid min-w-0 items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-2 text-foreground shadow-xs",
        ROW_COLUMNS,
        isExpired && "border-dashed bg-muted/40",
      )}
      data-media-row={attachment.id}
    >
      <Checkbox
        aria-label={t("chatPage.media.mark", { name: attachment.name })}
        checked={actions.selected.has(attachment.id)}
        disabled={isExpired}
        onChange={() => actions.toggleSelected(attachment.id)}
      />
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <p className="flex min-w-0 flex-col leading-tight">
        <button
          className="truncate text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:no-underline"
          disabled={isExpired}
          onClick={() => actions.open(file)}
          title={attachment.name}
          type="button"
        >
          {attachment.name}
        </button>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
        <span className="truncate text-xs text-muted-foreground @xl:hidden">
          {origin}
        </span>
      </p>
      <span className="hidden truncate text-xs text-muted-foreground @xl:block">
        {origin}
      </span>
      <span className="hidden @xl:block">
        <Retention file={file} now={actions.now} />
      </span>
      <span className="flex items-center justify-end gap-1">
        <span className="@xl:hidden">
          <Retention file={file} now={actions.now} />
        </span>
        <CardAction
          icon={MessageSquareText}
          isIconOnly
          label={t("chatPage.cards.toMessage")}
          onClick={() => actions.toMessage(file.messageId)}
          variant="quiet"
        />
        {isExpired ? null : (
          <CardDownloadAction
            download={{ href: downloadUrl(attachment) }}
            isIconOnly
          />
        )}
      </span>
    </li>
  );
}

/** Sounds, documents or files as rows that line up exactly. */
export function MediaRows({
  files,
  actions,
}: {
  readonly files: readonly ConversationMediaFile[];
  readonly actions: MediaItemActions;
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2 p-3">
      {files.map((file) => (
        <MediaRow key={file.attachment.id} actions={actions} file={file} />
      ))}
    </ul>
  );
}
