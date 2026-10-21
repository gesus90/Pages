import { readConfiguration } from "./configuration.js";
import { CredentialStoreError } from "./credential-error.js";
import { CredentialStore } from "./credential-store.js";
import { instanceEndpoint, readInstanceUrl } from "./instance-address.js";
import { postAgentRequest } from "./pages-client.js";
import {
  AGENT_API_ENDPOINT,
  PAIRED_TOKEN_PATTERN,
} from "./request-constants.js";

import type { PagesConfiguration } from "./configuration.js";

/** Uses an explicit environment credential first, otherwise the exact instance's private local entry. */
export async function readStdioConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<PagesConfiguration> {
  if (environment.PAGES_TOKEN !== undefined)
    return readConfiguration(environment);
  const instance = readInstanceUrl(environment.PAGES_URL);
  const store = new CredentialStore(environment);
  const credential = await store.get(instance);
  if (!credential)
    throw new CredentialStoreError(
      "No paired credential. Run pages-mcp pair --url <Pages instance> first.",
    );
  let token = credential.token;
  return {
    agentsUrl: instanceEndpoint(instance, AGENT_API_ENDPOINT),
    get token() {
      return token;
    },
    credentials: {
      refresh: async (invalidToken) => {
        const refreshed = await store.update(instance, async (current) => {
          if (current && current.token !== invalidToken)
            return { credential: current, result: current.token };
          return { credential: null, result: null };
        });
        if (!refreshed)
          throw new CredentialStoreError(
            "The paired credential is no longer valid. Run pages-mcp pair --url <Pages instance> again.",
          );
        token = refreshed;
        return token;
      },
      rotate: async (currentToken) => {
        token = await store.update(instance, async (current) => {
          if (!current)
            throw new CredentialStoreError(
              "No paired credential. Run pages-mcp pair first.",
            );
          if (current.token !== currentToken)
            return { credential: current, result: current.token };
          const replacement = await postAgentRequest(
            {
              agentsUrl: instanceEndpoint(instance, AGENT_API_ENDPOINT),
              token: current.token,
            },
            { operation: "credential.rotate", parameters: {} },
          );
          if (!isReplacement(replacement))
            throw new CredentialStoreError(
              "Pages returned an invalid rotation response. Pair the client again.",
            );
          return {
            credential: {
              ...current,
              token: replacement.token,
              expiresAt: replacement.expiresAt,
            },
            result: replacement.token,
          };
        });
        return token;
      },
    },
  };
}

function isReplacement(
  input: unknown,
): input is { token: string; expiresAt: number | null } {
  return (
    typeof input === "object" &&
    input !== null &&
    "token" in input &&
    typeof input.token === "string" &&
    PAIRED_TOKEN_PATTERN.test(input.token) &&
    "expiresAt" in input &&
    (input.expiresAt === null ||
      (typeof input.expiresAt === "number" &&
        Number.isSafeInteger(input.expiresAt)))
  );
}
