import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { storedDate } from "./file-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";

interface ExpiredAttachmentProps {
  readonly attachment: ConversationAttachment;
  /** A tile of a gallery shows the short form. */
  readonly isCompact?: boolean;
  readonly className?: string;
}

/**
 * The calm placeholder of a file an agent attached after its 72 hours:
 * "abgelaufen · erzeugt am …" with the name; the text of the
 * message stays.
 */
export function ExpiredAttachment({
  attachment,
  isCompact = false,
  className,
}: ExpiredAttachmentProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const date = storedDate(attachment, i18n.language);
  const label =
    date === ""
      ? t("chatPage.cards.expired.short")
      : t("chatPage.cards.expired.label", { date });
  if (isCompact)
    return (
      <span
        className={cn(
          "flex size-full flex-col items-center justify-center gap-1 bg-muted p-2 text-center text-xs text-muted-foreground",
          className,
        )}
        data-attachment-expired=""
        title={`${attachment.name} · ${label}`}
      >
        <Clock aria-hidden="true" className="size-4" />
        <span>{t("chatPage.cards.expired.short")}</span>
      </span>
    );
  return (
    <p
      className={cn(
        "flex w-full max-w-lg min-w-0 items-center gap-2.5 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
      data-attachment-expired=""
    >
      <Clock aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate font-medium text-foreground">
        {attachment.name}
      </span>
      <span className="shrink-0">{label}</span>
    </p>
  );
}
