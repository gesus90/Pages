import { postAgentRequest } from "../pages-client.js";

import type { PagesAgentReadOperation } from "../../../definition/PagesAgentOperations.js";
import type { PagesConfiguration } from "../configuration.js";

/** Calls an A9.5 operation; every call is freshly authenticated and authorized by Pages. */
export async function readOperation(
  configuration: PagesConfiguration,
  operation: PagesAgentReadOperation,
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
