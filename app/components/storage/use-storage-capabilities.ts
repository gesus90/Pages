import { useEffect, useState } from "react";

import { requestStorageCapabilities } from "./storage-actions-requests";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";

/**
 * Reads once per visit what the connected account may do in Storage.
 *
 * @returns The capabilities, or `null` while they load or when they are
 * unknown; without them the view offers no change.
 */
export function useStorageCapabilities(): StorageCapabilities | null {
  const [capabilities, setCapabilities] = useState<StorageCapabilities | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const reply = await requestStorageCapabilities(controller.signal);

      if (!controller.signal.aborted && reply.ok) {
        setCapabilities(reply.value);
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  return capabilities;
}
