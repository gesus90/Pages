import { AudioPlayer } from "./audio-player";
import { FileDetails } from "./file-card";
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
 * An attachment as the split view and the full-screen overlay show it
 * (PAGE-298); it fills its container and has no title bar of its own.
 *
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
