import type { PagesAgentApiFailure } from "@/definition/PagesAgentApi";

/**
 * Denies every credential until server-side token verification is available.
 * No account, permission or persistence lookup is permitted in this phase.
 */
export function rejectUnverifiedAgentCredential(): PagesAgentApiFailure {
  return {
    apiVersion: "1",
    error: {
      code: "AUTH_NOT_READY",
      message: "Agent authentication is not available yet.",
      retryable: false,
    },
  };
}
