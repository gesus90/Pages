import { AlertCircle, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { formatBytes } from "@/app/lib/format-bytes";

import { canRetryChatUpload } from "../use-chat-uploads";
import { attachmentTypeLabel } from "./attachment-type";
import {
  CARD_ACTION,
  CARD_OVERLAY_ACTION,
  CardFooter,
} from "./chat-attachment-card";
import { AttachmentPlaceholder } from "./chat-attachment-thumbnail";

import { chatErrorText } from "../chat-error";

import type { ChatUploadItem } from "../use-chat-uploads";

interface ChatUploadCardProps {
  readonly item: ChatUploadItem;
  readonly onRetry: (key: string) => void;
  readonly onDismiss: (key: string) => void;
}

/** Raster images the browser shows from the chosen file itself, before it is stored. */
const LOCAL_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Shows a chosen image from the file in the browser; the address is freed
 * when the card goes, so no blob address outlives its card.
 */
function useLocalImage(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!LOCAL_IMAGE_TYPES.has(file.type)) return undefined;
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return url;
}

function UploadStatus({
  item,
}: {
  readonly item: ChatUploadItem;
}): React.ReactElement {
  const { t } = useTranslation();
  if (item.status === "uploading")
    return (
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-surface/90 px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        {t("chat.files.uploadingItem")}
      </span>
    );
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive-subtle px-2 text-center text-destructive">
      <AlertCircle aria-hidden="true" className="size-4" />
      <span className="line-clamp-3 text-[0.625rem] leading-tight font-medium">
        {chatErrorText(t, item.error ?? "general")}
      </span>
    </span>
  );
}

/**
 * A chosen file that is not stored yet: its upload runs or failed (PAGE-92).
 * A failure names its reason and keeps every other file; it can be tried
 * again unless the file itself is refused.
 */
export function ChatUploadCard({
  item,
  onRetry,
  onDismiss,
}: ChatUploadCardProps): React.ReactElement {
  const { t } = useTranslation();
  const image = useLocalImage(item.file);
  const name = item.file.name;
  const facts = [attachmentTypeLabel(name), formatBytes(item.file.size)].join(
    " · ",
  );
  return (
    <li
      aria-busy={item.status === "uploading"}
      className={cn(
        "flex w-36 shrink-0 flex-col overflow-hidden rounded-xl bg-surface ring-1",
        item.status === "failed" ? "ring-destructive/40" : "ring-border",
      )}
    >
      <span className="relative block h-16 w-full overflow-hidden bg-muted">
        {image ? (
          <img
            alt={t("chat.files.imageAlt", { name })}
            className="size-full object-contain"
            src={image}
          />
        ) : (
          <AttachmentPlaceholder
            attachment={{ fileName: name, contentType: item.file.type }}
            reason={null}
          />
        )}
        <UploadStatus item={item} />
        <button
          aria-label={t(
            item.status === "uploading"
              ? "chat.files.cancelUpload"
              : "chat.removeAttachment",
            { name },
          )}
          className={CARD_OVERLAY_ACTION}
          onClick={() => onDismiss(item.key)}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </span>
      <CardFooter contentType={item.file.type} facts={facts} name={name}>
        {canRetryChatUpload(item) ? (
          <button
            aria-label={t("chat.files.retryName", { name })}
            className={CARD_ACTION}
            onClick={() => onRetry(item.key)}
            title={t("chat.files.retry")}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </CardFooter>
    </li>
  );
}
