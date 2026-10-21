import { isRecord } from "../is-record.js";
import { postAgentRequest } from "../pages-client.js";

import type { PagesConfiguration } from "../configuration.js";
import type { McpToolOperation } from "./tool-catalog.js";

/** Calls a JSON business operation; every call is freshly authenticated and authorized by Pages. */
export async function readOperation(
  configuration: PagesConfiguration,
  operation: McpToolOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const response = await postAgentRequest(
    configuration,
    { operation, parameters },
    { businessErrors: true },
  );
  if (!isRecord(response)) throw new Error("Pages read failed.");
  const envelope = response;
  if (envelope.apiVersion !== "1" || !isRecord(envelope.result))
    throw new Error("Pages read failed.");
  return envelope.result;
}
