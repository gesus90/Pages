/** Path of the Pica Mobile WebSocket endpoint on its own port. */
export const PICA_MOBILE_PATH = "/pica-mobile";

const LOWEST_PORT = 1;
const HIGHEST_PORT = 65_535;
const PORT_TEXT = /^\d{1,5}$/u;

/** Why a Pica Mobile port cannot be stored, or why the stored one is not bound. */
export type PicaMobilePortError =
  | "invalidPort"
  | "portInUse"
  | "portOfPages"
  | "permissionDenied"
  | "listenFailed"
  | "general";

/** What an administrator sees about the Pica Mobile endpoint. */
export interface PicaMobileSettingsView {
  /** Stored port; `null` while no port was ever saved. */
  readonly port: number | null;
  /** Whether the endpoint listens on the stored port right now. */
  readonly isListening: boolean;
  /** Why the stored port is not bound; `null` while it is or none is stored. */
  readonly listenError: PicaMobilePortError | null;
  /** Host a smartphone can reach the server at; `null` when none is known. */
  readonly host: string | null;
}

/** The answer of the settings action that stores a port. */
export type PicaMobilePortResult =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: PicaMobilePortError };

/**
 * Reads a port an administrator typed.
 *
 * @param text - Text of the input field.
 * @returns The port, or `null` when the text is no whole number from 1 to 65535.
 */
export function parsePicaMobilePort(text: string): number | null {
  const trimmed = text.trim();

  if (!PORT_TEXT.test(trimmed)) {
    return null;
  }

  const port = Number(trimmed);

  return port >= LOWEST_PORT && port <= HIGHEST_PORT ? port : null;
}

/**
 * Builds the address a smartphone enters in the app.
 *
 * @param host - Host the server can be reached at; IPv6 addresses need no brackets.
 * @param port - Port of the endpoint.
 * @returns A `ws://` address with the endpoint path.
 */
export function buildPicaMobileAddress(host: string, port: number): string {
  const authority = host.includes(":") ? `[${host}]` : host;

  return `ws://${authority}:${port}${PICA_MOBILE_PATH}`;
}
