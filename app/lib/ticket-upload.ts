import { isWikiAttachmentPath } from "@/app/lib/wiki-upload";

import type { WorkItemAttachment } from "@/definition/Task";

/** The address of a ticket attachment; only those show as images in tickets. */
const TICKET_ATTACHMENT_PATH = /^\/aufgaben\/attachments\/[\w-]+(?:\?.*)?$/;

/**
 * Tells whether an image address belongs to a ticket attachment of this
 * instance.
 *
 * @param src - Image address from the markdown.
 * @returns Whether the ticket views may show it.
 */
export function isTicketAttachmentPath(src: string): boolean {
  return TICKET_ATTACHMENT_PATH.test(src);
}

/**
 * Tells whether an image in a ticket description may be shown: attachments of
 * tickets and of wiki pages of this instance, never outside addresses.
 *
 * @param src - Image address from the markdown.
 * @returns Whether the description shows the image.
 */
export function isTicketDisplayableImage(src: string): boolean {
  return isTicketAttachmentPath(src) || isWikiAttachmentPath(src);
}

/**
 * The download address of a ticket attachment.
 *
 * @param attachmentId - Attachment identifier.
 * @returns The address the markdown and the attachment list point to.
 */
export function ticketAttachmentPath(attachmentId: string): string {
  return `/aufgaben/attachments/${attachmentId}`;
}

/** Thrown when an upload fails; the code names the reason as `tasks.error.<code>`. */
export class TicketUploadError extends Error {
  /** Key below `tasks.error` that describes the failure. */
  public readonly code: string;

  /**
   * Creates the error.
   *
   * @param code - Reason of the failure.
   */
  public constructor(code: string) {
    super(`Ticket upload failed: ${code}`);
    this.name = "TicketUploadError";
    this.code = code;
  }
}

function readAnswer(text: string): {
  readonly attachment?: WorkItemAttachment;
  readonly error?: string;
} {
  try {
    const body: unknown = JSON.parse(text);

    return typeof body === "object" && body !== null ? body : {};
  } catch {
    // An answer that is no JSON, such as a proxy error page, is a network failure.
    return {};
  }
}

/**
 * Sends a file to a ticket and reports the progress.
 *
 * @param ticketId - Ticket identifier.
 * @param file - The file the person chose, dropped or pasted.
 * @param onProgress - Called with the share that was sent, from 0 to 1.
 * @returns The attachment the server created.
 * @throws {TicketUploadError} When the server refuses the file or cannot be
 * reached.
 *
 * @remarks
 * The file travels as the plain body of a `PUT` request, so the server can
 * count and limit it while it streams in, as with wiki uploads.
 */
export function uploadTicketFile(
  ticketId: string,
  file: File,
  onProgress: (share: number) => void,
): Promise<WorkItemAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const address = `/aufgaben-api/attachments?ticket=${encodeURIComponent(ticketId)}&name=${encodeURIComponent(file.name)}`;

    request.open("PUT", address);
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? event.loaded / event.total : 0);
    };
    request.onerror = () => reject(new TicketUploadError("network"));
    request.onload = () => {
      const answer = readAnswer(request.responseText);

      if (request.status >= 200 && request.status < 300 && answer.attachment) {
        resolve(answer.attachment);
      } else {
        reject(new TicketUploadError(answer.error ?? "network"));
      }
    };
    request.send(file);
  });
}
