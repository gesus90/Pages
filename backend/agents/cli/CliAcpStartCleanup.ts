import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { closeCliSession } from "./CliSessionCloseout";

import type { CliGitHubAccess } from "./CliGitHubCredentials";
import type { CliSessionRequest } from "./CliContracts";
import type { CliSessionProcess } from "./CliSessionProcess";

/** A partially started session and its resources. */
interface StartCleanup {
  readonly instanceId: string;
  readonly github: CliGitHubAccess | null;
  readonly limited: { readonly request: CliSessionRequest } | null;
  readonly isPidNamespace: boolean;
}

async function closeFailedAcp(
  child: CliSessionProcess,
  cleanup: StartCleanup,
): Promise<boolean> {
  try {
    child.cancel("login_cancelled");
    return (
      await closeCliSession(
        child,
        cleanup.instanceId,
        undefined,
        cleanup.isPidNamespace,
      )
    ).isConfirmed;
  } catch (caughtError: unknown) {
    logCaughtError("CliSessionExecution", caughtError);
    return false;
  }
}

/** Cleans up only resources belonging to an unsuccessful ACP start. */
export async function cleanupAcpStart(
  child: CliSessionProcess | null,
  cleanup: StartCleanup,
): Promise<void> {
  if (child === null) await cleanup.limited?.request.unit?.settle();
  const isConfirmed = child === null || (await closeFailedAcp(child, cleanup));
  try {
    await cleanup.github?.cleanup();
  } catch (caughtError: unknown) {
    logCaughtError("CliSessionExecution", caughtError);
    if (isConfirmed) throw new AgentError("credential_cleanup_failed");
  }
  if (!isConfirmed) throw new AcpCleanupUnconfirmedError();
}
