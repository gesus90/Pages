import { methods } from "@agentclientprotocol/sdk";

import { logCaughtError } from "@/backend/logging/Logger";

import type { ClientConnection } from "@agentclientprotocol/sdk";

/** Closes the protocol session with a bounded wait before ending its process. */
export async function closeAcpProtocol(
  connection: ClientConnection,
  sessionId: string | null,
): Promise<void> {
  if (sessionId === null || connection.signal.aborted) return;
  let wait: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connection.agent.request(methods.agent.session.close, { sessionId }),
      new Promise<void>((resolve) => {
        wait = setTimeout(resolve, 5_000);
      }),
    ]);
  } catch (caughtError: unknown) {
    logCaughtError("AcpSession", caughtError);
  } finally {
    clearTimeout(wait);
  }
}
