import { isStableVersionAtLeast } from "./AgentToolVersion";

/** The oldest OpenCode release whose native ACP and credential contract Pages implements. */
export const SUPPORTED_OPENCODE_VERSION = "1.18.34";

/**
 * Whether a reported OpenCode version is a stable release Pages supports.
 * @param version - The version OpenCode reported.
 */
export function isSupportedOpenCodeVersion(version: string): boolean {
  return isStableVersionAtLeast(version, SUPPORTED_OPENCODE_VERSION);
}
