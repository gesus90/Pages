import { Paperclip } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { WikiUploadsState } from "@/app/components/wiki/use-wiki-uploads";

/** The toolbar button that opens the file chooser. */
export function AttachmentButton({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <Button
        aria-label={t("wiki.editor.attach")}
        size="icon-sm"
        title={t("wiki.editor.attach")}
        variant="ghost"
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" className="size-4" />
      </Button>
      <input
        ref={input}
        multiple
        aria-label={t("wiki.editor.attachInput")}
        className="sr-only"
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
    </>
  );
}

/** Progress and failure of the running upload. */
export function UploadStatus({
  uploads,
}: {
  readonly uploads: WikiUploadsState;
}): React.ReactElement | null {
  const { t } = useTranslation();

  if (uploads.errorCode !== null) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t(`wiki.errors.${uploads.errorCode}`)}
      </p>
    );
  }

  return uploads.progress === null ? null : (
    <p className="text-sm text-muted-foreground" role="status">
      {t("wiki.editor.uploading", {
        name: uploads.fileName,
        percent: Math.round(uploads.progress * 100),
      })}
    </p>
  );
}
