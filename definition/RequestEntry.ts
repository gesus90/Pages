/** The protocol a forwarding hop reported, as the entrance of the API read it. */
export type ReportedProtocol = "http" | "https" | "absent" | "invalid";

/**
 * How a request reached the API, as far as the entrance could verify it.
 *
 * @remarks
 * Only facts about the TCP peer and the forwarding headers of one request, never
 * an address, a header value or a credential. The origin guards use it to tell a
 * forwarding problem from a foreign origin and to explain a refusal in the log.
 */
export interface RequestEntry {
  /** What `X-Forwarded-Proto` said before the entrance replaced it. */
  readonly reportedProtocol: ReportedProtocol;
  /** The TCP peer is a proxy listed in `trustedProxies`; its protocol is believed. */
  readonly isTrustedProxy: boolean;
  /** A hop in front of Pages may have changed the request: a trusted or loopback peer, or forwarding headers. */
  readonly isForwarded: boolean;
}
