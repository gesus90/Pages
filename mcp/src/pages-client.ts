import { CredentialStoreError } from "./credential-error.js";
import { IMPORT_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "./request-constants.js";
import { operationFailure } from "./tools/operation-failure.js";

import type { PagesAgentApiRequest } from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";

function requestTimeout(operation: string): number {
  return [
    "wiki.import.apply",
    "wiki.import.update",
    "import.structured.apply",
  ].includes(operation)
    ? IMPORT_TIMEOUT_MS
    : REQUEST_TIMEOUT_MS;
}

/**
 * Sends the shared JSON envelope to Pages, without redirecting credentials.
 * Pages verifies the supplied personal credential for every request.
 * Network and API failures expose only fixed diagnostics.
 */
export async function postAgentRequest(
  configuration: PagesConfiguration,
  input: PagesAgentApiRequest,
  options: {
    readonly businessErrors?: boolean;
    readonly retryCredential?: boolean;
  } = {},
): Promise<unknown> {
  let response: Response;
  const requestedToken = configuration.token;
  try {
    response = await fetch(configuration.agentsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requestedToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout(input.operation)),
    });
  } catch {
    throw new Error("Could not reach the Pages agent API.");
  }
  if (!response.ok) {
    if (response.status === 401 && configuration.credentials) {
      await response.body?.cancel();
      const token = await configuration.credentials.refresh(requestedToken);
      if (options.retryCredential === false)
        throw new CredentialStoreError(
          "The paired credential is no longer valid. Run pages-mcp pair --url <Pages instance> again.",
        );
      return postAgentRequest(
        {
          agentsUrl: configuration.agentsUrl,
          token,
          credentials: configuration.credentials,
        },
        input,
        { ...options, retryCredential: false },
      );
    }
    if (options.businessErrors) {
      const failure = await operationFailure(response);
      if (failure) throw failure;
      throw new Error("The Pages agent API rejected the request.");
    }
    try {
      await response.body?.cancel();
    } catch {
      throw new Error("The Pages agent API rejected the request.");
    }
    throw new Error("The Pages agent API rejected the request.");
  }
  try {
    const result: unknown = await response.json();
    return result;
  } catch {
    throw new Error("The Pages agent API returned invalid JSON.");
  }
}
