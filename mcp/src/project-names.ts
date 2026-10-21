import { isRecord } from "./is-record.js";
import { postAgentRequest } from "./pages-client.js";

import type { PagesConfiguration } from "./configuration.js";

/** Requests the names of the projects the credential's owner may see; Pages decides which. */
export async function listProjectNames(
  configuration: PagesConfiguration,
): Promise<string[]> {
  const response = await postAgentRequest(configuration, {
    operation: "projects.names.list",
    parameters: {},
  });
  if (!isRecord(response)) throw new Error("Pages project listing failed.");
  const envelope = response;
  const names = envelope.projectNames;
  if (
    envelope.apiVersion !== "1" ||
    !Array.isArray(names) ||
    !names.every((name: unknown) => typeof name === "string")
  ) {
    throw new Error("Pages project listing failed.");
  }
  return names;
}
