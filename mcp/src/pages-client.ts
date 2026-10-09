import type { PagesAgentApiRequest } from "../../definition/PagesAgentApi.js";
import type { PagesConfiguration } from "./configuration.js";

/**
 * Sends the shared JSON envelope to Pages, without redirecting credentials.
 * Pages verifies the supplied personal or API delegation credential for every request.
 * Network and API failures expose only fixed diagnostics.
 */
export async function postAgentRequest(
  configuration: PagesConfiguration,
  input: PagesAgentApiRequest,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(configuration.agentsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error("Could not reach the Pages agent API.");
  }
  if (!response.ok) {
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
