import { redactCredentials } from "@/backend/security/AgentTextSafety";

import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaBrowserReply } from "./PicaBrowserContracts";

/** What the model should do next for each stable error code. */
const HINTS: Readonly<Record<string, string>> = {
  STALE_REF:
    "The page changed since the last observation. Call browser_observe and use the new references.",
  ELEMENT_NOT_ACTIONABLE:
    "The element is hidden, disabled or covered. Scroll it into view, close an overlay, or click by coordinates of the screenshot.",
  ACTION_TIMEOUT:
    "The action did not finish in time. Observe the page and try another way.",
  TARGET_REQUIRED: "Name an element reference or both x and y coordinates.",
  CREDENTIAL_DENIED:
    "You may not type passwords, codes or credentials. Call browser_handover so the administrator signs in themselves, then observe again.",
  URL_DENIED:
    "The browser may not reach this address: only public HTTPS sites, this Pages instance and services the server operator released.",
  URL_REQUIRED: "Give the address to open.",
  LOCAL_WRITE_NOT_APPROVED:
    "Changes to this local service need the administrator's approval in the browser view. Ask them to approve it; reading pages works without it.",
  NAVIGATION_FAILED:
    "The page could not be loaded. Check the address or try again later.",
  PAUSED_BY_ADMIN:
    "The administrator paused the browser. Wait a moment and call browser_observe again; do not open another browser.",
  ADMIN_HAS_CONTROL:
    "The administrator is using the browser. Wait and call browser_observe again until control returns; do not ask for credentials in the chat.",
  STOPPED_BY_ADMIN:
    "The administrator stopped the browser. Do not open another one; tell the person what you did so far.",
  BROWSER_CLOSED: "The browser is closed. Open a new one with browser_open.",
  SESSION_DENIED: "This browser does not exist or is not yours.",
  SESSION_NOT_FOUND:
    "No such saved session. Call browser_profiles for the available names.",
  SESSIONS_UNAVAILABLE: "Saved sessions are not available on this server.",
  RESOURCE_LIMIT:
    "Too many browsers are open, or a limit of this browser was reached.",
  SCREENSHOT_FAILED:
    "The screenshot could not be taken. Try browser_observe again.",
  TAB_NOT_FOUND: "That tab does not exist. Call browser_tabs with action list.",
  LAST_TAB:
    "The last tab cannot be closed. Use browser_close to end the browser.",
  USE_UPLOAD: "Use browser_upload for file fields.",
  FILE_DENIED: "The file is not allowed or not in your handover folder.",
  PATH_DENIED: "The file path is not allowed.",
  INVALID_KEYS:
    "The key name is unknown. Use names such as Enter, Tab, ArrowDown or Control+A.",
  BROWSER_ACTION_FAILED:
    "The browser could not do that. Observe the page and try another way.",
};

/**
 * Turns an observation into the outcome of a tool.
 *
 * @param reply - The bounded text and the screenshots.
 * @returns A successful outcome carrying the images for the model.
 */
export function browserOutcome(reply: PicaBrowserReply): PicaToolOutcome {
  return {
    ok: true,
    result: reply.text,
    error: null,
    ...(reply.images.length > 0 ? { images: [...reply.images] } : {}),
  };
}

/** What a failed call can still tell the model. */
export interface PicaBrowserFailureDetails {
  /** What the page looked like after the failure, when it may be shown. */
  readonly observation?: PicaBrowserReply | null;
  /** Further facts, such as the control state while the administrator drives. */
  readonly facts?: Readonly<Record<string, unknown>>;
}

/**
 * Turns a failure into an outcome that tells the model what to do next.
 *
 * @param code - The stable error code.
 * @param details - The observation and facts that go with it.
 * @returns A failed outcome with the code, a hint and the observation.
 */
export function browserFailureOutcome(
  code: string,
  details: PicaBrowserFailureDetails = {},
): PicaToolOutcome {
  const { observation = null, facts = {} } = details;
  let parsed: unknown = null;
  if (observation) {
    try {
      parsed = JSON.parse(observation.text);
    } catch {
      parsed = null;
    }
  }
  const text = redactCredentials(
    JSON.stringify({
      error: code,
      hint: HINTS[code] ?? "The call failed.",
      ...facts,
      ...(parsed === null ? {} : { observation: parsed }),
    }),
  );
  return {
    ok: false,
    result: text,
    error: code,
    ...(observation && observation.images.length > 0
      ? { images: [...observation.images] }
      : {}),
  };
}
