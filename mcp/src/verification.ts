import { postAgentRequest } from "./pages-client.js";

import type {
  PagesAgentApiBusinessOperation,
  PagesAgentApiIdentity,
} from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";

/** Fresh identity and the business operations Pages currently offers to it. */
export interface PagesVerification {
  readonly identity: PagesAgentApiIdentity;
  readonly tools: readonly PagesAgentApiBusinessOperation[];
}

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

function isKnownOperation(
  name: string,
): name is PagesAgentApiBusinessOperation {
  return name === "projects.names.list";
}

/**
 * Verifies current validity/rights for every request; a positive response is never cached.
 * Operations this package does not implement are ignored, so only known tools are exposed.
 */
export async function verifyPages(
  configuration: PagesConfiguration,
): Promise<PagesVerification> {
  const response = await postAgentRequest(configuration, {
    operation: "verify",
    parameters: {},
  });
  if (typeof response !== "object" || response === null)
    throw new Error("Pages verification failed.");
  const envelope = response as Record<string, unknown>;
  const tools = envelope.tools;
  if (
    envelope.apiVersion !== "1" ||
    !Array.isArray(tools) ||
    !tools.every((tool: unknown) => typeof tool === "string")
  )
    throw new Error("Pages verification failed.");
  return {
    identity: readVerifiedIdentity(envelope.identity),
    tools: tools.filter(isKnownOperation),
  };
}
