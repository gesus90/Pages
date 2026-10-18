import { useEffect, useState } from "react";

import {
  chatErrorCode,
  fetchChatAttachmentPreview,
} from "@/app/lib/chat-client";

import type { ChatAttachmentPreview } from "@/definition/ChatPreview";

/** Previews kept in the page; attachments never change, so one read serves card and viewer. */
const PREVIEW_CACHE_SIZE = 40;
const previews = new Map<string, Promise<ChatAttachmentPreview>>();

function loadPreview(id: string): Promise<ChatAttachmentPreview> {
  const cached = previews.get(id);
  if (cached) return cached;
  const loading = fetchChatAttachmentPreview(id);
  previews.set(id, loading);
  // A failed read is not kept, so opening the preview again tries anew.
  loading.catch(() => previews.delete(id));
  const oldest = previews.keys().next().value;
  if (previews.size > PREVIEW_CACHE_SIZE && oldest !== undefined)
    previews.delete(oldest);
  return loading;
}

/** The content preview of an attachment, or its loading state and failure. */
export interface AttachmentPreviewState {
  readonly preview: ChatAttachmentPreview | null;
  readonly error: string | null;
}

/**
 * Reads the content preview of a text, PDF or Office attachment once it is wanted.
 *
 * @param id - The attachment.
 * @param isWanted - Whether the preview is shown; nothing loads before.
 */
export function useAttachmentPreview(
  id: string,
  isWanted: boolean,
): AttachmentPreviewState {
  const [state, setState] = useState<AttachmentPreviewState>({
    preview: null,
    error: null,
  });

  useEffect(() => {
    if (!isWanted) return undefined;
    let isCurrent = true;
    loadPreview(id).then(
      (preview) => {
        if (isCurrent) setState({ preview, error: null });
      },
      (failure: unknown) => {
        if (isCurrent)
          setState({ preview: null, error: chatErrorCode(failure) });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [id, isWanted]);

  return state;
}
