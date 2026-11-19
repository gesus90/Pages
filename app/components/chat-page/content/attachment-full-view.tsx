import { File as FileIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AudioPlayer } from "./audio-player";
import { downloadUrl, formatFileSize } from "./card-types";
import { CardDownloadAction } from "./content-card";
import { PdfViewer } from "./pdf-viewer";
import { VideoPlayer } from "./video-player";

import type { ConversationAttachment } from "@/definition/ConversationContent";

const CENTERED_CLASS =
  "flex min-h-0 flex-1 items-center justify-center bg-panel-body p-6";

/** The full view of one attachment, by its kind. */
function AttachmentFullContent({
  attachment,
}: {
  readonly attachment: ConversationAttachment;
}): React.ReactElement {
  switch (attachment.kind) {
    case "image":
      return (
        <div className="relative min-h-0 flex-1 bg-panel-body">
          <img
            alt={attachment.name}
            className="absolute inset-0 size-full object-contain p-4"
            src={attachment.url}
          />
        </div>
      );
    case "pdf":
      return <PdfViewer className="min-h-0 flex-1" url={attachment.url} />;
    case "video":
      return <VideoPlayer attachment={attachment} isFilling />;
    case "audio":
      return (
        <div className={CENTERED_CLASS}>
          <AudioPlayer
            attachment={attachment}
            className="w-full max-w-xl rounded-xl border border-border bg-surface"
          />
        </div>
      );
    case "file":
      return (
        <div className={CENTERED_CLASS}>
          <FileDetails attachment={attachment} isFull />
        </div>
      );
  }
}

/**
 * An attachment as the split view and the full-screen overlay show it;
 * it fills its container and has no title bar of its own.
 * @remarks
 * An image shows the original, a PDF the viewer, a video and an audio file
 * their player, any other file its name, type and size with Laden.
 */
export function AttachmentFullView({
  attachment,
}: {
  readonly attachment: ConversationAttachment;
}): React.ReactElement {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-attachment-full-view={attachment.kind}
    >
      <AttachmentFullContent key={attachment.id} attachment={attachment} />
    </div>
  );
}

const UNKNOWN_MIME_TYPE = "application/octet-stream";

function fileTypeLabel(
  attachment: Pick<ConversationAttachment, "name" | "mimeType">,
): string | null {
  const type = attachment.mimeType.split(";")[0]?.trim() ?? "";
  if (type !== "" && type !== UNKNOWN_MIME_TYPE) return type;
  const dot = attachment.name.lastIndexOf(".");
  const extension = dot > 0 ? attachment.name.slice(dot + 1) : "";
  return extension === "" ? null : extension.toUpperCase();
}

function FileDetails({
  attachment,
  isFull = false,
}: {
  readonly attachment: ConversationAttachment;
  readonly isFull?: boolean;
}): React.ReactElement {
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
      <CardDownloadAction download={{ href: downloadUrl(attachment) }} />
    </div>
  );
}
