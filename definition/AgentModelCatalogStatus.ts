import { z } from "zod";

import { isAgentProvider, isModelProviderGroup } from "./AgentConnection";

import type { AgentProviderId, ModelProviderGroup } from "./AgentConnection";

/**
 * What a person can learn about the model list of one connection.
 * - `loaded`: the last listing delivered models.
 * - `empty`: the connection is active, but no listing delivered a model.
 * - `failed`: the last listing failed; models of an earlier listing stay.
 * - `unverified`: the access of the connection is not confirmed, so none of
 *   its models can run.
 */
export type ConnectionCatalogState =
  "loaded" | "empty" | "failed" | "unverified";

/** The catalog state of one connection the person may use; never a credential or error detail. */
export interface ConnectionCatalogStatus {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly provider: AgentProviderId;
  /**
   * The provider group a model choice lists the connection under, where it is
   * not the provider: the Z.AI Coding Plan for an OpenCode connection with a
   * subscription key. Absent for a connection listed under its provider.
   */
  readonly group?: ModelProviderGroup;
  readonly state: ConnectionCatalogState;
  /** When the last listing ended, successful or not; `null` before the first one. */
  readonly lastAttemptAt: string | null;
  /** The models the connection offers in total, before any place filters them. */
  readonly modelCount: number;
}

/**
 * How a saved connection relates to the person who looks at it.
 * - `available`: the person may use the connection.
 * - `denied`: the connection exists, but this account may not use it.
 * - `missing`: no such connection exists any more.
 */
export type SavedConnectionState = "available" | "denied" | "missing";

/** The answer of the catalog status route. */
export interface ModelCatalogStatuses {
  /** The connections the person may use, in the order of the administration. */
  readonly connections: readonly ConnectionCatalogStatus[];
  /** Whether the person may reload a catalog, which only administrators may. */
  readonly canReload: boolean;
  /** The state of the connection the request asked about; `null` when it asked about none. */
  readonly savedConnection: SavedConnectionState | null;
}

const providerSchema = z.custom<AgentProviderId>(isAgentProvider);
const groupSchema = z.custom<ModelProviderGroup>(isModelProviderGroup);

/** Validates what the catalog status route answered before a model choice uses it. */
export const modelCatalogStatusesSchema = z.object({
  connections: z.array(
    z.object({
      connectionId: z.string(),
      connectionName: z.string(),
      provider: providerSchema,
      group: groupSchema.optional(),
      state: z.enum(["loaded", "empty", "failed", "unverified"]),
      lastAttemptAt: z.string().nullable(),
      modelCount: z.number().int().nonnegative(),
    }),
  ),
  canReload: z.boolean(),
  savedConnection: z.enum(["available", "denied", "missing"]).nullable(),
});
