import { AgentProfileError } from "@/backend/error/AgentProfileError";

const STATUS_OF_CODE = {
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  payload_too_large: 413,
} as const;

/**
 * Answers a read of the agent profiles for the user interface (PAGE-308).
 *
 * @param read - Reads the profile data with the rights of the signed-in person.
 * @returns The data as JSON that no cache keeps; a refusal answers `{ "error": "<code>" }`.
 */
export async function agentProfileResponse(
  read: () => Promise<unknown>,
): Promise<Response> {
  try {
    return Response.json(await read(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentProfileError)) throw error;
    return Response.json(
      { error: error.code },
      { status: STATUS_OF_CODE[error.code] },
    );
  }
}
