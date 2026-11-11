import { Download, File as FileIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { downloadUrl, formatFileSize } from "./card-types";
import { CardAction, ContentCard } from "./content-card";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** The type the server stores for a file whose type nobody named. */
const UNKNOWN_MIME_TYPE = "application/octet-stream";

/**
 * The type of a file as a person reads it.
 *
 * @param attachment - The file.
 * @returns Its MIME type; for a file without a known one its extension in
 * upper case, or `null` when it has neither.
 */
export function fileTypeLabel(
  attachment: Pick<ConversationAttachment, "name" | "mimeType">,
): string | null {
  const type = attachment.mimeType.split(";")[0]?.trim() ?? "";
  if (type !== "" && type !== UNKNOWN_MIME_TYPE) return type;
  const dot = attachment.name.lastIndexOf(".");
  const extension = dot > 0 ? attachment.name.slice(dot + 1) : "";
  return extension === "" ? null : extension.toUpperCase();
}

interface FileDetailsProps {
  readonly attachment: ConversationAttachment;
  /** Centered with a Laden link, as the split view and the full screen show a file. */
  readonly isFull?: boolean;
}

/** Name, type and size of a file that has no view of its own. */
export function FileDetails({
  attachment,
  isFull = false,
}: FileDetailsProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const type = fileTypeLabel(attachment) ?? t("chatPage.cards.kind.file");
  const size = formatFileSize(attachment.sizeBytes, i18n.language);
  if (!isFull)
    return (
      <p className="flex min-w-0 items-baseline gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{attachment.name}</span>
        <span className="shrink-0">
          {type} · {size}
        </span>
      </p>
    );
  return (
    <div className="flex max-w-md flex-col items-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileIcon aria-hidden="true" className="size-6" />
      </span>
      <p className="max-w-full text-sm font-semibold break-all text-foreground">
        {attachment.name}
      </p>
      <p className="text-xs text-muted-foreground">
        {type} · {size}
      </p>
      <CardAction
        href={downloadUrl(attachment)}
        icon={Download}
        label={t("chatPage.cards.download")}
      />
    </div>
  );
}

/**
 * The card of a file the chat has no view for (PAGE-298): one line with
 * name, type and size, and Laden.
 */
export function FileCard({
  attachment,
}: {
  readonly attachment: ConversationAttachment;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <ContentCard
      actions={
        <CardAction
          href={downloadUrl(attachment)}
          icon={Download}
          label={t("chatPage.cards.download")}
        />
      }
      cardKey={`att:${attachment.id}`}
      className="max-w-lg"
      defaultState="expanded"
      icon={FileIcon}
      kindLabel={t("chatPage.cards.kind.file")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
    >
      <FileDetails attachment={attachment} />
    </ContentCard>
  );
}
