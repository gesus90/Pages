import { AgentError } from "@/backend/error/AgentErrors";

/**
 * Runs a reader and reports how it refused its input.
 *
 * @param work - The reader call under test.
 * @returns The code of a thrown `AgentError`, `"other"` for any other thrown
 * value, or `null` when the reader accepted the input.
 */
export function agentErrorCode(work: () => unknown): string | null {
  try {
    work();
  } catch (error: unknown) {
    return error instanceof AgentError ? error.code : "other";
  }

  return null;
}
