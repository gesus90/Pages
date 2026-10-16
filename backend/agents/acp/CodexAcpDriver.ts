import { AgentError } from "@/backend/error/AgentErrors";

import { findUnmanagedCodexConfiguration } from "./CodexAcpConfigurationGuard";
import {
  CODEX_ACP_BINARY,
  isSupportedCodexAcp,
  planCodexAcpLaunch,
} from "./CodexAcpAdapter";
import { codexAcpProfile } from "./CodexAcpProfile";

import type { AcpDriver } from "./AcpDriver";

/** The Codex CLI as an ACP runner, through the `codex-acp` adapter. */
export const CODEX_ACP_DRIVER: AcpDriver = {
  provider: "codex_cli",
  binary: CODEX_ACP_BINARY,
  supportedVersions: "2.1.1 up to 3.0.0",
  errors: {
    modeRequired: "codex_permission_mode_required",
    adapterMissing: "plan_acp_adapter_missing",
    adapterUnsupported: "plan_acp_adapter_unsupported",
    sessionFailed: "plan_acp_session_failed",
  },
  isSupportedAdapter: isSupportedCodexAcp,
  profile: codexAcpProfile,
  plan: (specification) =>
    planCodexAcpLaunch({
      ...specification,
      profile: codexAcpProfile(
        specification.profile.mode,
        specification.purpose,
      ),
    }),
  requireManagedConfiguration: async (home, directory) => {
    const unmanaged = await findUnmanagedCodexConfiguration(
      home.config,
      directory,
    );
    if (unmanaged === null) return;
    console.warn(
      `Pages refused a Codex plan node because of ${unmanaged}, a Codex configuration file that Pages does not manage.`,
    );
    throw new AgentError("plan_codex_configuration_unmanaged");
  },
};
