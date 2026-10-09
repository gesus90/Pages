import type { WikiAttachment } from "@/definition/Wiki";

/** The address of an attachment of this instance; only those show as images. */
export const WIKI_ATTACHMENT_PATH = /^\/wiki\/attachments\/[\w-]+(?:\?.*)?$/;

/**
 * Tells whether an image address belongs to an attachment of this instance.
 *
 * @param src - Image address from the markdown.
 * @returns Whether the renderer and the editor may show it.
 */
export function isWikiAttachmentPath(src: string): boolean {
  return WIKI_ATTACHMENT_PATH.test(src);
}

/** Thrown when an upload fails; the code names the reason for the person. */
export class WikiUploadError extends Error {
  /** Key below `wiki.errors` that describes the failure. */
  public readonly code: string;

  /**
   * Creates the error.
   *
   * @param code - Reason of the failure.
   */
  public constructor(code: string) {
    super(`Wiki upload failed: ${code}`);
    this.name = "WikiUploadError";
    this.code = code;
  }
}

function readBody(text: string): {
  attachment?: WikiAttachment;
  error?: string;
} {
  try {
    const body: unknown = JSON.parse(text);

    return typeof body === "object" && body !== null ? body : {};
  } catch {
    return {};
  }
}

/**
 * Sends a file to a page and reports the progress.
 *
 * @param pageId - Page identifier.
 * @param file - The file the person chose, dropped or pasted.
 * @param onProgress - Called with the share that was sent, from 0 to 1.
 * @returns The attachment the server created.
 * @throws {WikiUploadError} When the server refuses the file or cannot be
 * reached.
 *
 * @remarks
 * The file travels as the plain body of a `PUT` request, so the server can
 * count and limit it while it streams in.
 */
export function uploadWikiFile(
  pageId: string,
  file: File,
  onProgress: (share: number) => void,
): Promise<WikiAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const address = `/wiki-api/attachments?page=${encodeURIComponent(pageId)}&name=${encodeURIComponent(file.name)}`;

    request.open("PUT", address);
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? event.loaded / event.total : 0);
    };
    request.onerror = () => reject(new WikiUploadError("network"));
    request.onload = () => {
      const body = readBody(request.responseText);

      if (request.status >= 200 && request.status < 300 && body.attachment) {
        resolve(body.attachment);
      } else {
        reject(new WikiUploadError(body.error ?? "network"));
      }
    };
    request.send(file);
  });
}

/**
 * Writes the markdown that shows or links an uploaded file.
 *
 * @param attachment - The attachment.
 * @returns An image for embeddable files, otherwise a link; both point to the
 * download address of the attachment.
 */
export function formatAttachmentMarkdown(attachment: WikiAttachment): string {
  const name = attachment.fileName.replace(/([[\]\\])/g, "\\$1");
  const address = `/wiki/attachments/${attachment.id}`;

  return attachment.isEmbeddable
    ? `![${name}](${address})`
    : `[${name}](${address})`;
}
