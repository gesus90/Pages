import { File as FileIcon, Image as ImageIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { useWikiUploads } from "@/app/components/wiki/use-wiki-uploads";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";
import {
  AttachmentButton,
  UploadStatus,
} from "@/app/components/wiki/wiki-editor-uploads";
import { formatBytes } from "@/app/lib/format-bytes";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiAttachment } from "@/definition/Wiki";

/** An attachment together with what the person may do with it. */
export interface WikiAttachmentEntry extends WikiAttachment {
  readonly canRemove: boolean;
}

interface WikiAttachmentsViewProps {
  readonly pageId: string;
  readonly attachments: readonly WikiAttachmentEntry[];
  readonly canUpload: boolean;
}

/** The files attached to a page, with upload, download and removal. */
export function WikiAttachmentsView({
  pageId,
  attachments,
  canUpload,
}: WikiAttachmentsViewProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const revalidator = useRevalidator();
  const uploads = useWikiUploads(pageId, () => void revalidator.revalidate());
  const [removing, setRemoving] = useState<WikiAttachmentEntry | null>(null);

  if (attachments.length === 0 && !canUpload) {
    return null;
  }

  return (
    <section aria-label={t("wiki.attachments.title")} className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase">
          {t("wiki.attachments.title")}
        </h2>
        {canUpload ? (
          <div className="flex items-center gap-1">
            <AttachmentButton onFiles={(files) => void uploads.upload(files)} />
          </div>
        ) : null}
      </div>
      <UploadStatus uploads={uploads} />
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("wiki.attachments.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              {attachment.isEmbeddable ? (
                <ImageIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              ) : (
                <FileIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              )}
              <a
                className="min-w-0 flex-1 truncate text-primary hover:underline"
                download={attachment.fileName}
                href={`/wiki/attachments/${attachment.id}?download=1`}
              >
                {attachment.fileName}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(attachment.size)} · {attachment.uploadedByName} ·{" "}
                {formatDateTime(attachment.createdAt)}
              </span>
              {attachment.canRemove ? (
                <Button
                  aria-label={t("wiki.attachments.remove", {
                    name: attachment.fileName,
                  })}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setRemoving(attachment)}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {removing ? (
        <WikiActionDialog
          action={wikiPagePath(pageId)}
          description={t("wiki.attachments.removeDescription")}
          fields={{ attachmentId: removing.id, intent: "delete-attachment" }}
          isDestructive
          submitLabel={t("wiki.attachments.removeSubmit")}
          title={t("wiki.attachments.removeTitle", { name: removing.fileName })}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </section>
  );
}
