import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { CoverSurface } from "@/app/components/wiki/wiki-page-cover";
import { uploadWikiFile, WikiUploadError } from "@/app/lib/wiki-upload";
import { formatWikiCover, WIKI_COVER_PRESETS } from "@/definition/Wiki";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiAttachment, WikiCover } from "@/definition/Wiki";

interface WikiCoverDialogProps {
  readonly pageId: string;
  readonly attachments: readonly WikiAttachment[];
  readonly onClose: () => void;
}

function CoverChoice({
  cover,
  label,
  onPick,
}: {
  readonly cover: WikiCover;
  readonly label: string;
  readonly onPick: (cover: WikiCover) => void;
}): React.ReactElement {
  return (
    <button
      aria-label={label}
      className="overflow-hidden rounded-lg ring-offset-2 hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary"
      type="button"
      onClick={() => onPick(cover)}
    >
      <CoverSurface className="block h-14 w-full" cover={cover} />
    </button>
  );
}

/** A titled grid of covers to choose from. */
function CoverGroup({
  title,
  choices,
  onPick,
}: {
  readonly title: string;
  readonly choices: readonly {
    readonly cover: WikiCover;
    readonly label: string;
  }[];
  readonly onPick: (cover: WikiCover) => void;
}): React.ReactElement {
  return (
    <>
      <h3 className="mt-5 mb-2 text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {choices.map((choice) => (
          <CoverChoice
            key={formatWikiCover(choice.cover)}
            cover={choice.cover}
            label={choice.label}
            onPick={onPick}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Uploads an image to the page and chooses it as cover; other files are
 * refused, since only images can be a cover.
 */
function useCoverUpload(
  pageId: string,
  choose: (cover: WikiCover) => void,
): {
  readonly isUploading: boolean;
  readonly errorCode: string | null;
  readonly start: (file: File) => Promise<void>;
} {
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  return {
    errorCode,
    isUploading,
    start: async (file) => {
      setIsUploading(true);
      setErrorCode(null);

      try {
        const attachment = await uploadWikiFile(pageId, file, () => undefined);

        if (attachment.isEmbeddable) {
          choose({ attachmentId: attachment.id, kind: "attachment" });
        } else {
          setErrorCode("invalidCover");
        }
      } catch (error: unknown) {
        setErrorCode(error instanceof WikiUploadError ? error.code : "network");
      } finally {
        setIsUploading(false);
      }
    },
  };
}

/**
 * Chooses the cover of a page: a prepared gradient, an image already
 * attached to the page, or a new image that is uploaded to the page.
 */
export function WikiCoverDialog({
  pageId,
  attachments,
  onClose,
}: WikiCoverDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<WikiActionResult>();
  const input = useRef<HTMLInputElement | null>(null);
  const images = attachments.filter((attachment) => attachment.isEmbeddable);
  const result = fetcher.data;
  const hasSucceeded = result?.ok === true;

  useEffect(() => {
    if (hasSucceeded) {
      onClose();
    }
  }, [hasSucceeded, onClose]);

  function choose(cover: WikiCover): void {
    void fetcher.submit(
      { cover: formatWikiCover(cover), intent: "set-cover" },
      { action: `/wiki/${pageId}`, method: "post" },
    );
  }

  const upload = useCoverUpload(pageId, choose);
  const errorCode =
    upload.errorCode ?? (result?.ok === false ? result.error : null);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.cover.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.cover.description")}
        </DialogDescription>
        <CoverGroup
          choices={WIKI_COVER_PRESETS.map((preset) => ({
            cover: { kind: "preset", preset },
            label: t(`wiki.cover.preset.${preset}`),
          }))}
          title={t("wiki.cover.presets")}
          onPick={choose}
        />
        {images.length > 0 ? (
          <CoverGroup
            choices={images.map((image) => ({
              cover: { attachmentId: image.id, kind: "attachment" },
              label: image.fileName,
            }))}
            title={t("wiki.cover.images")}
            onPick={choose}
          />
        ) : null}
        {errorCode ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {t(`wiki.errors.${errorCode}`)}
          </p>
        ) : null}
        <div className="mt-6 flex justify-between gap-2">
          <Button
            isPending={upload.isUploading}
            variant="outline"
            onClick={() => input.current?.click()}
          >
            <Upload aria-hidden="true" className="size-4" />
            {t("wiki.cover.upload")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("wiki.dialog.cancel")}
          </Button>
        </div>
        <input
          ref={input}
          accept="image/jpeg,image/png,image/gif,image/webp"
          aria-label={t("wiki.cover.upload")}
          className="sr-only"
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const [file] = event.target.files ?? [];

            event.target.value = "";

            if (file) {
              void upload.start(file);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
