import type {
  DiscordActionErrorCode,
  DiscordActionResult,
} from "@/definition/Discord";

/** The actions of the Discord panel; each one is an `intent` of the project route. */
export type DiscordIntent =
  "start" | "confirm" | "channel" | "events" | "test" | "disconnect" | "cancel";

/** How the panel talks to the project's Discord route. */
export interface DiscordRequest {
  readonly projectId: string;
  /** `GET` reads the state; `POST` carries the intent and its fields. */
  readonly intent?: DiscordIntent;
  readonly fields?: Readonly<Record<string, string>>;
  /** Lists the channels of the connected server too. */
  readonly includeChannels?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function failure(error: DiscordActionErrorCode): DiscordActionResult {
  return { error, ok: false };
}

/**
 * Checks that a response body has the shape of an action result.
 *
 * @param value - Parsed JSON from the server.
 * @returns Whether it is a success with a state or a failure with a code.
 */
export function isDiscordActionResult(
  value: unknown,
): value is DiscordActionResult {
  if (!isRecord(value)) {
    return false;
  }

  return value["ok"] === true
    ? isRecord(value["state"])
    : value["ok"] === false && typeof value["error"] === "string";
}

/**
 * Sends one request of the Discord panel and reads its result.
 *
 * @param request - Project, intent and fields.
 * @returns The result; a network error or a body of the wrong shape becomes a
 * failure with the code `request_failed`.
 */
export async function requestDiscord(
  request: DiscordRequest,
): Promise<DiscordActionResult> {
  const address = `/projekte/${encodeURIComponent(request.projectId)}/discord`;

  try {
    const response = request.intent
      ? await fetch(address, {
          body: new URLSearchParams({
            intent: request.intent,
            ...request.fields,
          }),
          method: "POST",
        })
      : await fetch(
          request.includeChannels ? `${address}?channels=1` : address,
        );
    const body: unknown = await response.json();

    return isDiscordActionResult(body) ? body : failure("request_failed");
  } catch {
    return failure("request_failed");
  }
}

/**
 * Turns an event selection into the form fields the events action reads.
 *
 * @param events - The complete selection of the four event types.
 * @returns `"on"` for a switched-on event and an empty text for a switched-off one.
 */
export function toEventFields(
  events: Readonly<Record<string, boolean>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(events).map(([type, isOn]) => [type, isOn ? "on" : ""]),
  );
}
