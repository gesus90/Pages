import { useEffect, useState } from "react";

import type { CardText } from "./card-types";

/** The text of a card: there, on its way, or not loadable. */
export interface LoadedCardText {
  /** The text; `null` until it is loaded. */
  readonly source: string | null;
  readonly isFailed: boolean;
}

/**
 * The text of a code, diff or Markdown card: the one the message carries, or
 * the content of the attachment, loaded once the card shows it.
 *
 * @param text - The text or the address of the attachment that holds it.
 * @param isShown - Whether the card is expanded or opened; an attachment is
 * not loaded before.
 */
export function useCardText(text: CardText, isShown: boolean): LoadedCardText {
  const { source, sourceUrl } = text;
  const [loaded, setLoaded] = useState<LoadedCardText>({
    source: null,
    isFailed: false,
  });
  const isNeeded = source === null && sourceUrl !== undefined && isShown;

  useEffect(() => {
    if (!isNeeded || sourceUrl === undefined) return undefined;
    const controller = new AbortController();
    async function load(url: string): Promise<void> {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("The attachment could not be loaded.");
      const content = await response.text();
      if (!controller.signal.aborted)
        setLoaded({ source: content, isFailed: false });
    }
    load(sourceUrl).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.warn("The text of a chat card could not be loaded", error);
      setLoaded({ source: null, isFailed: true });
    });
    return () => controller.abort();
  }, [isNeeded, sourceUrl]);

  return source === null ? loaded : { source, isFailed: false };
}

/**
 * Copies text to the clipboard.
 *
 * @param text - The text to copy.
 */
export function copyText(text: string): void {
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    console.warn("The text could not be copied", error);
  });
}

/**
 * Saves text of a message as a file of the browser.
 *
 * @param fileName - The name the file is offered with.
 * @param text - Its content.
 */
export function saveTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
