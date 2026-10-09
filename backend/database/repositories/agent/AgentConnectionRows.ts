import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentProvider } from "@/definition/AgentConnection";

import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** Persistence metadata deliberately excludes the encrypted secret. */
export interface AgentConnectionRecord {
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  readonly reasoningEffort: string | null;
  readonly cliLoggedInAt: string | null;
  readonly cliAccountLabel: string | null;
  readonly updatedAt: string;
}

export const CONNECTION_COLUMNS = `
    id,
    name,
    provider,
    secret_encrypted IS NOT NULL AS has_api_key,
    test_model,
    cli_logged_in_at,
    cli_account_label,
    updated_at,
    reasoning_effort
`;

/** Maps explicit columns, rejecting an unsupported stored provider. */
export function readAgentConnection(
  row: readonly DatabaseValue[],
): AgentConnectionRecord {
  const provider = readTextColumn(row, 2, "provider");
  if (!isAgentProvider(provider)) throw new AgentError("provider_invalid");
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    provider,
    hasApiKey: readBooleanColumn(row, 3, "has_api_key"),
    testModel: readNullableTextColumn(row, 4, "test_model"),
    cliLoggedInAt: readNullableTextColumn(row, 5, "cli_logged_in_at"),
    cliAccountLabel: readNullableTextColumn(row, 6, "cli_account_label"),
    updatedAt: readTextColumn(row, 7, "updated_at"),
    reasoningEffort: readNullableTextColumn(row, 8, "reasoning_effort"),
  };
}
