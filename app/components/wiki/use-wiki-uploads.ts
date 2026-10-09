import { useState } from "react";

import {
  formatAttachmentMarkdown,
  uploadWikiFile,
  WikiUploadError,
} from "@/app/lib/wiki-upload";

import type { WikiAttachment } from "@/definition/Wiki";

/** The files being sent and the outcome of the last upload. */
export interface WikiUploadsState {
  /** Share sent of the running upload, from 0 to 1; `null` while idle. */
  readonly progress: number | null;
  /** Name of the file that is being sent. */
  readonly fileName: string | null;
  /** Reason the last upload failed, as a key below `wiki.errors`. */
  readonly errorCode: string | null;
  /**
   * Sends files one after the other and reports each result; resolves with
   * the attachments that were stored.
   */
  readonly upload: (files: readonly File[]) => Promise<WikiAttachment[]>;
}

/**
 * Sends the files a person chose, dropped or pasted into a page.
 *
 * @param pageId - Page the files belong to.
 * @param onUploaded - Called with the markdown for each finished upload.
 * @returns The state of the uploads and the function that starts them.
 */
export function useWikiUploads(
  pageId: string,
  onUploaded: (markdown: string) => void,
): WikiUploadsState {
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  return {
    errorCode,
    fileName,
    progress,
    upload: async (files) => {
      const stored: WikiAttachment[] = [];

      setErrorCode(null);

      for (const file of files) {
        setFileName(file.name);
        setProgress(0);

        try {
          const attachment = await uploadWikiFile(pageId, file, setProgress);

          stored.push(attachment);
          onUploaded(formatAttachmentMarkdown(attachment));
        } catch (error: unknown) {
          setErrorCode(
            error instanceof WikiUploadError ? error.code : "network",
          );
        }
      }

      setProgress(null);
      setFileName(null);

      return stored;
    },
  };
}
