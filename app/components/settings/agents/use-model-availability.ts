import { useEffect, useRef } from "react";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentActions } from "./use-agent-actions";

/** Whether the selection may appear yet, and whether its list is loading. */
export interface AgentModelAvailability {
  readonly isExisting: boolean;
  readonly isUnlocked: boolean;
  readonly isLoading: boolean;
}

/**
 * Tells since when a connection may offer its model selection.
 *
 * @param connection - The saved connection, if any.
 * @returns The CLI login time, the time of a passed API access check, or `null`.
 */
export function modelAccessSince(
  connection: AgentConnectionSummary | undefined,
): string | null {
  if (!connection) return null;
  if (connection.cli) return connection.cli.loggedInAt;
  const auth = connection.checks.auth;
  return auth?.status === "passed" ? auth.checkedAt : null;
}

// A list not loaded since the latest access is due; a failed attempt counts as loaded.
function isCatalogDue(
  catalog: AgentModelCatalog | undefined,
  accessSince: string | null,
): boolean {
  if (!catalog || accessSince === null) return false;
  return (
    catalog.attemptedAt === null ||
    Date.parse(catalog.attemptedAt) < Date.parse(accessSince)
  );
}

/**
 * Tells whether the model selection may appear and loads a model list that
 * is older than the latest confirmed access.
 *
 * @remarks
 * The server already loads the list after each access check or sign-in and
 * stores a default model (A7 §21.6). This covers access confirmed before
 * that, such as older check results. A list attempted after the latest access
 * is left alone, so a failed attempt is not retried in a loop.
 */
export function useModelAvailability({
  connection,
  catalog,
  actions,
  isBlocked,
}: {
  readonly connection: AgentConnectionSummary | undefined;
  readonly catalog: AgentModelCatalog | undefined;
  readonly actions: AgentActions;
  readonly isBlocked: boolean;
}): AgentModelAvailability {
  const accessSince = modelAccessSince(connection);
  const requested = useRef<string | null>(null);
  const id = connection?.id;
  const isDue = isCatalogDue(catalog, accessSince);
  const { submit } = actions;
  useEffect(() => {
    if (!id || !isDue || accessSince === null || isBlocked) return;
    if (requested.current === accessSince) return;
    requested.current = accessSince;
    submit("refresh-catalog", id);
  }, [id, isDue, accessSince, isBlocked, submit]);
  return {
    isExisting: connection !== undefined,
    isUnlocked: accessSince !== null,
    isLoading: actions.pendingIntent === "refresh-catalog",
  };
}
