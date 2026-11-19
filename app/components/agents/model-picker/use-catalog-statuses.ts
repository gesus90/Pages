import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { modelCatalogStatusesSchema } from "@/definition/AgentModelCatalogStatus";

import type { ModelCatalogStatuses } from "@/definition/AgentModelCatalogStatus";

/** The route that answers the catalog state of the connections the person may use. */
const STATUS_ENDPOINT = "/agent-api/model-catalogs";

/** What a model choice knows about the catalogs of its connections. */
export interface CatalogStatusState {
  /** The last answer; `null` before the first one and after a failed request. */
  readonly statuses: ModelCatalogStatuses | null;
  readonly isLoading: boolean;
  /** The connection whose catalog is being reloaded right now. */
  readonly reloadingId: string | null;
  /** The connection whose last reload failed. */
  readonly failedId: string | null;
  readonly reload: (connectionId: string) => Promise<void>;
}

async function requestStatuses(
  input: RequestInfo,
  init: RequestInit,
): Promise<ModelCatalogStatuses | null> {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) return null;
  const parsed = modelCatalogStatusesSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

function isStillUnverified(
  answer: ModelCatalogStatuses,
  connectionId: string,
): boolean {
  return answer.connections.some(
    (status) =>
      status.connectionId === connectionId && status.state === "unverified",
  );
}

function statusUrl(savedConnectionId: string | null): string {
  return savedConnectionId === null
    ? STATUS_ENDPOINT
    : `${STATUS_ENDPOINT}?connection=${encodeURIComponent(savedConnectionId)}`;
}

/**
 * Reads the catalog state of the connections while a model choice needs it.
 * @param input - The request counter and the connection of the saved model.
 * @returns The state and the reload of a single connection.
 * @remarks
 * Only stored catalogs are read; neither opening nor searching asks a
 * provider. A reload asks the provider of that one connection, then lets the
 * page load its models anew, so the list and the status stay one picture.
 */
export function useCatalogStatuses(input: {
  /** Counts the reasons to read: each opening of the choice, a saved model that is gone. Zero reads nothing. */
  readonly requestKey: number;
  readonly savedConnectionId: string | null;
  /** Called once a reload has ended, whether it succeeded or not. */
  readonly onReloaded?: () => void;
}): CatalogStatusState {
  const { requestKey, savedConnectionId, onReloaded } = input;
  const { revalidate } = useRevalidator();
  const [statuses, setStatuses] = useState<ModelCatalogStatuses | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadingId, setReloadingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    if (requestKey === 0) return undefined;
    const controller = new AbortController();
    setIsLoading(true);
    requestStatuses(statusUrl(savedConnectionId), {
      signal: controller.signal,
    })
      .then((answer) => {
        if (controller.signal.aborted) return;
        setStatuses(answer);
        setIsLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [requestKey, savedConnectionId]);

  async function reload(connectionId: string): Promise<void> {
    setReloadingId(connectionId);
    setFailedId(null);
    try {
      const answer = await requestStatuses(STATUS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (answer === null) setFailedId(connectionId);
      else {
        setStatuses(answer);
        // The reload of an unconfirmed connection checks its access; a check that did not pass leaves it unconfirmed.
        if (isStillUnverified(answer, connectionId)) setFailedId(connectionId);
      }
    } catch {
      setFailedId(connectionId);
    }
    setReloadingId(null);
    onReloaded?.();
    await revalidate();
  }

  return { statuses, isLoading, reloadingId, failedId, reload };
}
