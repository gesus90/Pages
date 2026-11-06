import { CredentialStoreError } from "./credential-error.js";
import { correlationHeaders } from "./request-correlation.js";
import {
  IMPORT_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  WRITE_REQUEST_TIMEOUT_MS,
} from "./request-constants.js";
import { PagesTransportError } from "./pages-transport-error.js";
import { operationFailure } from "./tools/operation-failure.js";

import type { PagesAgentApiRequest } from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";

/** Operations that only read; any other, also an unknown one, gets the longer budget of a write. */
const SHORT_READ_OPERATION =
  /(?:^verify|\.(?:read|readRange|list|search|resolve|plan))$/u;

function requestTimeout(operation: string): number {
  if (
    operation === "wiki.import.apply" ||
    operation === "wiki.import.update" ||
    operation === "import.structured.apply"
  )
    return IMPORT_TIMEOUT_MS;
  const needsWriteBudget =
    operation.startsWith("plans.") ||
    operation.startsWith("workspaces.") ||
    !SHORT_READ_OPERATION.test(operation);
  return needsWriteBudget ? WRITE_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
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
        ...correlationHeaders(),
      },
      body: JSON.stringify(input),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout(input.operation)),
    });
  } catch {
    throw new PagesTransportError();
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
