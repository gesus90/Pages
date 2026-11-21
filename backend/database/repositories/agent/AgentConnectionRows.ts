import { codexPriceMappingsSchema } from "@/backend/service/agents/usage/CodexPriceMappings";
import { claudePriceModelsSchema } from "@/definition/ClaudePriceModels";
import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  isAgentProvider,
  RETIRED_PROVIDER_IDS,
} from "@/definition/AgentConnection";

import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** Persistence metadata deliberately excludes the encrypted secret. */
export interface AgentConnectionRecord {
  readonly codexPriceMappings?: Readonly<Record<string, string>>;
  readonly claudePriceModels?: Readonly<Record<string, string>>;
  readonly isActive: boolean;
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  readonly reasoningEffort: string | null;
  readonly cliLoggedInAt: string | null;
  readonly cliAccountLabel: string | null;
  readonly updatedAt: string;
  readonly openRouterModelIds?: Readonly<Record<string, string>>;
}

/**
 * The retired provider IDs as a quoted SQL list.
 * @remarks
 * Built from fixed constants only, never from input. Connections of a retired
 * provider stay in the table but no query that feeds a list, a choice or a
 * run reads them.
 */
export const RETIRED_PROVIDER_SQL_LIST = RETIRED_PROVIDER_IDS.map(
  (provider) => `'${provider}'`,
).join(", ");

export const CONNECTION_COLUMNS = `
    id,
    name,
    provider,
    secret_encrypted IS NOT NULL AS has_api_key,
    test_model,
    cli_logged_in_at,
    cli_account_label,
    updated_at,
    reasoning_effort,
    is_active,
    codex_price_mappings,
    claude_price_models,
    openrouter_model_ids::text
`;

/** Maps explicit columns, rejecting an unsupported stored provider. */
export function readAgentConnection(
  row: readonly DatabaseValue[],
): AgentConnectionRecord {
  const provider = readTextColumn(row, 2, "provider");
  if (!isAgentProvider(provider)) throw new AgentError("provider_invalid");
  const mappingText = readTextColumn(row, 12, "openrouter_model_ids");
  const mapping: unknown = JSON.parse(mappingText);
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping))
    throw new AgentError("profile_invalid");
  const openRouterModelIds = Object.fromEntries(
    Object.entries(mapping).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    isActive: readBooleanColumn(row, 9, "is_active"),
    codexPriceMappings:
      typeof row[10] === "string"
        ? codexPriceMappingsSchema.parse(JSON.parse(row[10]))
        : {},
    claudePriceModels: claudePriceModelsSchema.parse(
      JSON.parse(
        readNullableTextColumn(row, 11, "claude_price_models") ?? "{}",
      ),
    ),
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    provider,
    hasApiKey: readBooleanColumn(row, 3, "has_api_key"),
    testModel: readNullableTextColumn(row, 4, "test_model"),
    cliLoggedInAt: readNullableTextColumn(row, 5, "cli_logged_in_at"),
    cliAccountLabel: readNullableTextColumn(row, 6, "cli_account_label"),
    updatedAt: readTextColumn(row, 7, "updated_at"),
    reasoningEffort: readNullableTextColumn(row, 8, "reasoning_effort"),
    openRouterModelIds,
  };
}
