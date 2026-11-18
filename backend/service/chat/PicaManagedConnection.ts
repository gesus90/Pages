import { findUnmanagedCodexHomeConfiguration } from "@/backend/agents/acp/CodexAcpConfigurationGuard";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logDiagnostic } from "@/backend/logging/Logger";

import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";

/** Checks whether the connection of an assignment is one Pica may start a session with. */
export type PicaConnectionCheck = (
  assignment: ResolvedAgentAssignment,
) => Promise<void>;

/**
 * Builds the check that keeps Pica off a Codex connection with a foreign configuration.
 * @param credentials - Resolves the folders of a connection; nothing is created.
 * @returns A check that refuses such a connection before a message is stored
 * or a choice is saved.
 * @remarks
 * Pica reads only, so the session start already refuses a Codex folder that
 * holds a `config.toml` Pages did not write. This check names that reason
 * early, as the cause of the choice, instead of as a failed start. It only
 * tests the file's existence and never opens, changes or removes it, so the
 * configuration of the profile stays as the operator left it. A clean,
 * separate Codex connection is the way to use Pica with Codex.
 */
export function picaManagedConnectionCheck(
  credentials: Pick<AgentCredentialStore, "paths">,
): PicaConnectionCheck {
  return async (assignment) => {
    const { connection } = assignment;
    if (connection.provider !== "codex_cli") return;
    const unmanaged = await findUnmanagedCodexHomeConfiguration(
      credentials.paths(connection.id, connection.provider).config,
    );
    if (unmanaged === null) return;
    logDiagnostic(
      "PicaManagedConnection",
      "warn",
      `Pica refused the Codex connection because of ${unmanaged}, a Codex configuration file that Pages does not manage.`,
    );
    throw new AgentExecutionError("picaCodexConfigurationUnmanaged");
  };
}
