import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { closeCliSession } from "./CliSessionCloseout";

import type { CliSessionContainment } from "./CliSessionCloseout";
import type { CliGitHubAccess } from "./CliGitHubCredentials";
import type { CliSessionRequest } from "./CliContracts";
import type { CliSessionProcess } from "./CliSessionProcess";

/** The process of a session start: the ACP worker. */
type StartedProcess = Pick<CliSessionProcess, "cancel" | "endInput" | "exited">;

/** A partially started session and its resources. */
interface StartCleanup {
  readonly instanceId: string;
  readonly github: CliGitHubAccess | null;
  readonly limited: { readonly request: CliSessionRequest } | null;
  readonly containment: CliSessionContainment;
}

async function closeFailedAcp(
  child: StartedProcess,
  cleanup: StartCleanup,
): Promise<boolean> {
  try {
    child.cancel("login_cancelled");
    return (
      await closeCliSession(
        child,
        cleanup.instanceId,
        undefined,
        cleanup.containment,
      )
    ).isConfirmed;
  } catch (caughtError: unknown) {
    logCaughtError("CliSessionExecution", caughtError);
    return false;
  }
}

/** Cleans up only resources belonging to an unsuccessful ACP start. */
export async function cleanupAcpStart(
  child: StartedProcess | null,
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

/**
 * Cleans up an unsuccessful ACP start together with the Pica bundle it prepared.
 *
 * @remarks
 * The bundle stays when the worker's end is unconfirmed, since the worker may
 * still read it; every other failure removes it.
 */
export async function cleanupFailedAcpStart(
  child: CliSessionProcess | null,
  cleanup: StartCleanup,
  cleanupBundle: (() => void) | undefined,
): Promise<void> {
  try {
    await cleanupAcpStart(child, cleanup);
  } catch (cleanupError: unknown) {
    if (!(cleanupError instanceof AcpCleanupUnconfirmedError))
      cleanupBundle?.();
    throw cleanupError;
  }
  cleanupBundle?.();
}
