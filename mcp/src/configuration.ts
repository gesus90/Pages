import { instanceEndpoint, readInstanceUrl } from "./instance-address.js";
import {
  AGENT_API_ENDPOINT,
  BEARER_TOKEN_PATTERN,
} from "./request-constants.js";

/** Validated instance URL and opaque Bearer credential; not an authenticated identity. */
export interface PagesConfiguration {
  readonly agentsUrl: URL;
  readonly token: string;
  /** Local credential lifecycle, absent for explicit environment credentials. */
  readonly credentials?: {
    readonly refresh: (invalidToken: string) => Promise<string>;
    readonly rotate: (currentToken: string) => Promise<string>;
  };
}

/**
 * Reads only the two supported settings and reports errors without their contents.
 * HTTPS, loopback and private IPv4 HTTP instances are accepted.
 */
export function readConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): PagesConfiguration {
  const baseUrl = readInstanceUrl(environment.PAGES_URL);
  const token = environment.PAGES_TOKEN;
  if (!token || !BEARER_TOKEN_PATTERN.test(token)) {
    throw new Error(
      "PAGES_TOKEN must be a nonempty Bearer credential without whitespace.",
    );
  }
  return { agentsUrl: instanceEndpoint(baseUrl, AGENT_API_ENDPOINT), token };
}
