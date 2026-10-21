/** Why an address cannot be used for the Pages server. */
export type ServerAddressProblem =
  "empty" | "invalid" | "insecure" | "credentials" | "extras";

/** The result of checking an address the person typed. */
export type ServerAddressResult =
  | { readonly ok: true; readonly url: string; readonly host: string }
  | { readonly ok: false; readonly problem: ServerAddressProblem };

/** Options of the address check. */
export interface ServerAddressOptions {
  /**
   * Accept `http://`. The app sets this only in development builds; a release
   * build talks to Pages over HTTPS and nothing else.
   */
  readonly allowInsecureHttp?: boolean;
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function withScheme(input: string): string {
  return SCHEME_PATTERN.test(input) ? input : `https://${input}`;
}

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function findProblem(
  url: URL,
  options: ServerAddressOptions,
): ServerAddressProblem | null {
  const isHttps = url.protocol === "https:";
  const isAllowedHttp = url.protocol === "http:" && options.allowInsecureHttp;

  if (!isHttps && !isAllowedHttp) {
    return url.protocol === "http:" ? "insecure" : "invalid";
  }

  if (url.hostname === "") {
    return "invalid";
  }

  if (url.username !== "" || url.password !== "") {
    return "credentials";
  }

  if (url.search !== "" || url.hash !== "") {
    return "extras";
  }

  return null;
}

/**
 * Checks and normalizes the address of a Pages server.
 *
 * @param input - What the person typed; the scheme may be left out.
 * @param options - Whether plain HTTP is accepted.
 * @returns The normalized address without a trailing slash and its host, or the
 * reason the address cannot be used.
 */
export function parseServerAddress(
  input: string,
  options: ServerAddressOptions = {},
): ServerAddressResult {
  const trimmed = input.trim();

  if (trimmed === "") {
    return { ok: false, problem: "empty" };
  }

  const url = parseUrl(withScheme(trimmed));

  if (url === null) {
    return { ok: false, problem: "invalid" };
  }

  const problem = findProblem(url, options);

  if (problem !== null) {
    return { ok: false, problem };
  }

  const path = url.pathname.replace(/\/+$/, "");

  return { ok: true, url: `${url.origin}${path}`, host: url.host };
}
