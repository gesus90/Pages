import { operationFailure } from "./tools/operation-failure.js";

import type { PagesConfiguration } from "./configuration.js";

/** Sends raw file bytes directly to Pages with a separate five-minute budget and no extra credential. */
export async function uploadAgentAsset(
  configuration: PagesConfiguration,
  ticket: string,
  body: ReadableStream<Uint8Array>,
): Promise<unknown> {
  const uploadUrl = new URL(configuration.agentsUrl);
  uploadUrl.pathname = uploadUrl.pathname.replace(/agents$/, "agent-assets");
  const options: RequestInit & { readonly duplex: "half" } = {
    method: "POST",
    headers: {
      "X-Pages-Upload-Ticket": ticket,
      "Content-Type": "application/octet-stream",
    },
    body,
    duplex: "half",
    redirect: "error",
    signal: AbortSignal.timeout(300_000),
  };
  let response: Response;
  try {
    response = await fetch(uploadUrl, options);
  } catch {
    throw new Error("Could not upload the Pages asset.");
  }
  if (!response.ok) {
    const failure = await operationFailure(response);
    if (failure) throw failure;
    throw new Error("The Pages asset upload was rejected.");
  }
  try {
    const result: unknown = await response.json();
    return result;
  } catch {
    throw new Error("The Pages asset upload returned invalid JSON.");
  }
}
