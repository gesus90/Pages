import { useEffect, useState } from "react";

import {
  loadStoragePreview,
  releaseStoragePreview,
} from "./storage-preview-load";

import type { StoragePreviewOutcome } from "./storage-preview-load";

/** The preview of one file. */
export interface StoragePreviewModel {
  /** How loading ended; `null` while the file loads. */
  readonly outcome: StoragePreviewOutcome | null;
  /** Loads the file again; the fresh answer replaces the failed one. */
  readonly retry: () => void;
}

/** An outcome with the file and the attempt it belongs to. */
interface LoadedPreview {
  readonly ref: string;
  readonly attempt: number;
  readonly outcome: StoragePreviewOutcome;
}

/**
 * Loads a file for the preview whenever its reference changes or a retry asks.
 * @param ref - The reference of the file; `null` while no preview is open.
 * @returns The outcome and the retry.
 * @remarks
 * Every opening asks the server again, with the rights of the account at that
 * moment. An answer belongs to the file and the attempt that asked: when the
 * preview moves to another file or closes, its requests are aborted, a late
 * answer is dropped, and what the outcome holds open is released.
 */
export function useStoragePreview(ref: string | null): StoragePreviewModel {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);

  useEffect(() => {
    if (ref === null) return undefined;

    const fileRef = ref;
    const controller = new AbortController();
    let shown: StoragePreviewOutcome | null = null;

    async function load(): Promise<void> {
      const outcome = await loadStoragePreview(fileRef, controller.signal);

      if (controller.signal.aborted) {
        releaseStoragePreview(outcome);
        return;
      }

      shown = outcome;
      setLoaded({ attempt, outcome, ref: fileRef });
    }

    void load();

    return () => {
      controller.abort();

      if (shown !== null) releaseStoragePreview(shown);

      // Opening the same file again must not show the answer of the last time.
      setLoaded(null);
    };
  }, [ref, attempt]);

  const isCurrent =
    ref !== null && loaded?.ref === ref && loaded.attempt === attempt;

  return {
    outcome: isCurrent ? loaded.outcome : null,
    retry: () => setAttempt((current) => current + 1),
  };
}
