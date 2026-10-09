import { postAgentRequest } from "./pages-client.js";

import type { PagesAgentApiIdentity } from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";

/** Narrows a verified identity without exposing unknown server fields to the MCP client. */
export function readVerifiedIdentity(input: unknown): PagesAgentApiIdentity {
  if (typeof input !== "object" || input === null)
    throw new Error("Pages verification failed.");
  const identity = input as Record<string, unknown>;
  if (
    typeof identity.userId !== "string" ||
    !identity.userId ||
    typeof identity.isAdmin !== "boolean" ||
    !Array.isArray(identity.permissions) ||
    !identity.permissions.every(
      (permission: unknown) => typeof permission === "string",
    )
  ) {
    throw new Error("Pages verification failed.");
  }
  return {
    userId: identity.userId,
    isAdmin: identity.isAdmin,
    permissions: identity.permissions,
  };
}

/** Verifies current validity/rights for every request; a positive response is never cached. */
export async function verifyPages(
  configuration: PagesConfiguration,
): Promise<PagesAgentApiIdentity> {
  const response = await postAgentRequest(configuration, {
    operation: "verify",
    parameters: {},
  });
  if (typeof response !== "object" || response === null)
    throw new Error("Pages verification failed.");
  const envelope = response as Record<string, unknown>;
  if (
    envelope.apiVersion !== "1" ||
    !Array.isArray(envelope.tools) ||
    envelope.tools.length !== 0
  )
    throw new Error("Pages verification failed.");
  return readVerifiedIdentity(envelope.identity);
}
