import { useEffect, useRef } from "react";

import {
  canSendFromPreview,
  isPreviewReady,
  PREVIEW_RENDER_MESSAGE,
  readPreviewSend,
} from "./preview-document";

/**
 * Connects a sandbox frame with the chat: hands the frame its
 * document once it is ready, and passes on what the preview writes with
 * `pages.chat.send(text)`.
 * @remarks
 * Only messages of this one frame count. A message reaches the chat only
 * when {@link canSendFromPreview} confirms that the person just clicked or
 * typed in the frame; everything else the preview posts is ignored.
 * @param frame - The frame of the preview.
 * @param html - The document the frame shows.
 * @param onSend - Writes the text into the chat as a message of the person.
 */
export function usePreviewBridge(
  frame: React.RefObject<HTMLIFrameElement | null>,
  html: string,
  onSend: (text: string) => void,
): void {
  const lastSentAt = useRef(0);

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const element = frame.current;
      if (!element?.contentWindow || event.source !== element.contentWindow)
        return;
      if (isPreviewReady(event.data)) {
        element.contentWindow.postMessage(
          { type: PREVIEW_RENDER_MESSAGE, html },
          "*",
        );
        return;
      }
      const text = readPreviewSend(event.data);
      if (text === null) return;
      const now = Date.now();
      if (
        !canSendFromPreview({
          frame: element,
          lastSentAt: lastSentAt.current,
          now,
        })
      )
        return;
      lastSentAt.current = now;
      onSend(text);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [frame, html, onSend]);
}
