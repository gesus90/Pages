import { contentDisposition } from "@/app/lib/content-disposition";

import type { ChatAttachment } from "@/definition/Chat";

/** A downloaded attachment runs no script and loads nothing. */
const ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/**
 * The headers of a chat attachment download, for the web and for Pica Mobile.
 *
 * @param attachment - The attachment that is sent.
 * @returns Headers that make the file a download that is never shown inline,
 * so an SVG or HTML source cannot run in the origin of Pages.
 */
export function chatAttachmentDownloadHeaders(
  attachment: Pick<ChatAttachment, "fileName" | "contentType" | "size">,
): Record<string, string> {
  return {
    "Cache-Control": "private, no-cache",
    "Content-Disposition": contentDisposition(
      "attachment",
      attachment.fileName,
    ),
    "Content-Length": String(attachment.size),
    "Content-Security-Policy": ATTACHMENT_CONTENT_SECURITY_POLICY,
    "Content-Type": attachment.contentType,
    "X-Content-Type-Options": "nosniff",
  };
}
