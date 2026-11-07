import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";

/** Revokes one paired machine through the connections route action. */
export interface McpDeviceRevoke {
  readonly isPending: boolean;
  /** Whether the last revocation failed. */
  readonly hasFailed: boolean;
  readonly revoke: () => void;
}

/**
 * Sends the revocation of a machine and announces its success.
 *
 * @param deviceId - The machine to revoke.
 */
export function useMcpDeviceRevoke(deviceId: string): McpDeviceRevoke {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    mcpDevice?: { isRevoked: boolean };
    error?: string;
  }>();
  const isSending = useRef(false);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      isSending.current = true;
      return;
    }

    if (!isSending.current) {
      return;
    }

    isSending.current = false;

    if (fetcher.data?.mcpDevice) {
      showSuccessToast(t("settings.connections.mcpDevices.revoked"));
    }
  }, [fetcher.state, fetcher.data, t]);

  function revoke(): void {
    const form = new FormData();

    form.set("intent", "revoke-mcp-device");
    form.set("deviceId", deviceId);
    void fetcher.submit(form, { method: "post" });
  }

  return {
    isPending: fetcher.state !== "idle",
    hasFailed: fetcher.state === "idle" && fetcher.data?.error !== undefined,
    revoke,
  };
}
