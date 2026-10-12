import { WRITE_TOOLS } from "./tools/write-registry.js";
import { READ_TOOLS } from "./tools/registry.js";
import { COMMENT_TOOLS } from "./tools/wiki-comments.js";

import { postAgentRequest } from "./pages-client.js";

import type {
  PagesAgentApiBusinessOperation,
  PagesAgentApiIdentity,
} from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";
import type { McpCredentialDetails } from "../../definition/McpPairing.js";

/** Fresh identity and the business operations Pages currently offers to it. */
export interface PagesVerification {
  readonly identity: PagesAgentApiIdentity;
  readonly tools: readonly PagesAgentApiBusinessOperation[];
  readonly credential?: McpCredentialDetails;
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
  return (
    name === "projects.names.list" ||
    [...READ_TOOLS, ...COMMENT_TOOLS, ...WRITE_TOOLS].some(
      (entry) => entry.operation === name,
    )
  );
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
  const credential = readCredential(envelope.credential);
  if (credential?.rotationRequested && configuration.credentials) {
    const token = await configuration.credentials.rotate(configuration.token);
    return verifyPages({ agentsUrl: configuration.agentsUrl, token });
  }
  return {
    identity: readVerifiedIdentity(envelope.identity),
    tools: tools.filter(isKnownOperation),
    ...(credential ? { credential } : {}),
  };
}

function readCredential(input: unknown): McpCredentialDetails | undefined {
  if (input === undefined || input === null) return undefined;
  if (
    typeof input !== "object" ||
    !("id" in input) ||
    typeof input.id !== "string" ||
    !("name" in input) ||
    typeof input.name !== "string" ||
    !("expiresAt" in input) ||
    (input.expiresAt !== null && typeof input.expiresAt !== "number") ||
    !("rotationRequested" in input) ||
    typeof input.rotationRequested !== "boolean"
  )
    throw new Error("Pages verification failed.");
  return {
    id: input.id,
    name: input.name,
    expiresAt: input.expiresAt,
    rotationRequested: input.rotationRequested,
  };
}
