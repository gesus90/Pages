import { useEffect, useState } from "react";

import { requestStorageCapabilities } from "./storage-actions-requests";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";

/**
 * Reads once per visit what the connected account may do in Storage.
 *
 * @returns The capabilities, or `null` while they load or when they are
 * unknown; without them the view offers no change.
 */
export function useStorageCapabilities(
  folderRef?: string | null,
): StorageCapabilities | null {
  const [reading, setReading] = useState<{
    readonly folderRef: string | null | undefined;
    readonly capabilities: StorageCapabilities;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const reply = await requestStorageCapabilities(
        controller.signal,
        folderRef,
      );

      if (!controller.signal.aborted && reply.ok) {
        setReading({ folderRef, capabilities: reply.value });
      } else if (!controller.signal.aborted) {
        setReading(null);
      }
    }

    void load();

    return () => controller.abort();
  }, [folderRef]);

  return reading !== null && reading.folderRef === folderRef
    ? reading.capabilities
    : null;
}
