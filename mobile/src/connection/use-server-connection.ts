import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { checkServerConnection } from "@/api/health";
import { PagesClient } from "@/api/pages-client";
import { parseServerAddress } from "@/api/server-address";
import { SERVER_ADDRESS_OPTIONS } from "./address-policy";

import type { ConnectionStatus } from "@/api/health";

/** The connection to the configured Pages server. */
export interface ServerConnection {
  readonly status: ConnectionStatus;
  /** Host of the configured server, or `null` when none is configured. */
  readonly host: string | null;
  /** When the last check finished, or `null` before the first one. */
  readonly checkedAt: Date | null;
  /** Checks the connection again. */
  readonly recheck: () => void;
}

interface CheckResult {
  readonly status: ConnectionStatus;
  readonly checkedAt: Date | null;
}

const INITIAL_RESULT: CheckResult = { status: "checking", checkedAt: null };

function deriveStatus(
  hasServer: boolean,
  isDeviceOnline: boolean,
  result: CheckResult,
): ConnectionStatus {
  if (!hasServer) {
    return "unconfigured";
  }

  return isDeviceOnline ? result.status : "offline";
}

/**
 * Tracks whether the configured Pages server answers.
 *
 * @param serverUrl - Stored address of the server, or `null`.
 * @param isDeviceOnline - Whether the device has a network connection.
 * @returns The status, the host and a function that checks again. The server is
 * checked when the address changes, when the device comes back online, when the
 * app returns to the foreground and when `recheck` is called.
 */
export function useServerConnection(
  serverUrl: string | null,
  isDeviceOnline: boolean,
): ServerConnection {
  const [result, setResult] = useState<CheckResult>(INITIAL_RESULT);
  const [round, setRound] = useState(0);
  const address =
    serverUrl === null
      ? null
      : parseServerAddress(serverUrl, SERVER_ADDRESS_OPTIONS);
  const baseUrl = address?.ok ? address.url : null;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setRound((current) => current + 1);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (baseUrl === null || !isDeviceOnline) {
      return undefined;
    }

    const controller = new AbortController();
    const client = new PagesClient({ baseUrl });

    setResult(INITIAL_RESULT);
    checkServerConnection(client, { signal: controller.signal })
      .then((status) => {
        if (!controller.signal.aborted) {
          setResult({ status, checkedAt: new Date() });
        }
      })
      .catch((error: unknown) => {
        console.error("[pica] The connection check failed.", error);

        if (!controller.signal.aborted) {
          setResult({ status: "unreachable", checkedAt: new Date() });
        }
      });

    return () => controller.abort();
  }, [baseUrl, isDeviceOnline, round]);

  return {
    status: deriveStatus(baseUrl !== null, isDeviceOnline, result),
    host: address?.ok ? address.host : null,
    checkedAt: result.checkedAt,
    recheck: () => setRound((current) => current + 1),
  };
}
