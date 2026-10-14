import { postAgentRequest } from "../pages-client.js";

import type { AgentTextRangeReadOperation } from "../../../definition/AgentTextRange.js";
import type { AgentExtensionReadOperation } from "../../../definition/AgentExtensions.js";
import type { AgentAdminReadOperation } from "../../../definition/AgentAdministration.js";
import type { AgentWorkspaceReadOperation } from "../../../definition/AgentWorkspaceOperations.js";
import type { PageAgentReadOperation } from "../../../definition/PageAgentOperations.js";
import type { PagesAgentWriteOperation } from "../../../definition/PagesAgentWrites.js";
import type {
  PagesAgentCommentOperation,
  PagesAgentReadOperation,
  PagesAgentStructuredReadOperation,
  PagesAgentTicketReadOperation,
} from "../../../definition/PagesAgentOperations.js";
import type { PagesConfiguration } from "../configuration.js";

/** Calls a JSON business operation; every call is freshly authenticated and authorized by Pages. */
export async function readOperation(
  configuration: PagesConfiguration,
  operation:
    | AgentExtensionReadOperation
    | AgentAdminReadOperation
    | AgentWorkspaceReadOperation
    | PageAgentReadOperation
    | AgentTextRangeReadOperation
    | PagesAgentReadOperation
    | PagesAgentStructuredReadOperation
    | PagesAgentTicketReadOperation
    | PagesAgentCommentOperation
    | PagesAgentWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const response = await postAgentRequest(
    configuration,
    { operation, parameters },
    { businessErrors: true },
  );
  if (typeof response !== "object" || response === null)
    throw new Error("Pages read failed.");
  const envelope = response as Record<string, unknown>;
  if (
    envelope.apiVersion !== "1" ||
    typeof envelope.result !== "object" ||
    envelope.result === null ||
    Array.isArray(envelope.result)
  )
    throw new Error("Pages read failed.");
  return envelope.result as Record<string, unknown>;
}
