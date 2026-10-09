import { useState } from "react";

import { TicketUploadError, uploadTicketFile } from "@/app/lib/ticket-upload";

import type { WorkItemAttachment } from "@/definition/Task";

/** The file being sent to a ticket and the outcome of the last upload. */
export interface TicketUploadsState {
  /** Share sent of the running upload, from 0 to 1; `null` while idle. */
  readonly progress: number | null;
  readonly fileName: string | null;
  /** Reason the last upload failed, as a key below `tasks.error`. */
  readonly errorCode: string | null;
  /** Sends files one after the other; resolves with those that were stored. */
  readonly upload: (files: readonly File[]) => Promise<WorkItemAttachment[]>;
}

/**
 * Sends the files a person chose, dropped or pasted to a ticket.
 *
 * @param ticketId - Ticket the files belong to.
 * @param onUploaded - Called after the uploads, to show the new attachments.
 * @returns The state of the uploads and the function that starts them.
 */
export function useTicketUploads(
  ticketId: string,
  onUploaded: () => void,
): TicketUploadsState {
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  return {
    errorCode,
    fileName,
    progress,
    upload: async (files) => {
      const stored: WorkItemAttachment[] = [];

      setErrorCode(null);

      for (const file of files) {
        setFileName(file.name);
        setProgress(0);

        try {
          stored.push(await uploadTicketFile(ticketId, file, setProgress));
        } catch (error: unknown) {
          setErrorCode(
            error instanceof TicketUploadError ? error.code : "network",
          );
        }
      }

      setProgress(null);
      setFileName(null);

      if (stored.length > 0) {
        onUploaded();
      }

      return stored;
    },
  };
}
