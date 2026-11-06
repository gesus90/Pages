import { z } from "zod";

import type { LiveChange } from "./LiveChange";

/**
 * Version of the contract between `pages-core` and `pages-api` (PAGE-237).
 *
 * @remarks
 * `core/src/contract.rs` mirrors this file. Both sides refuse every other
 * version: a changed contract gets a new version and a new path, so an old
 * core and a new API never misread each other, they deliver nothing.
 */
export const PAGES_CORE_CONTRACT_VERSION = 1;

/** The API path where `pages-core` asks who may learn about which event. */
export const PAGES_CORE_LIVE_DECISIONS_PATH = "/api/core/v1/live-decisions";

/** Bounds of one request; the core splits larger rounds. */
export const PAGES_CORE_LIMITS = {
  sessions: 200,
  events: 256,
  /** The longest `Cookie` header the core passes on. */
  cookieLength: 8192,
  sessionKeyLength: 64,
  /** The longest object id and audience id, as the outbox stores them. */
  idLength: 200,
  /** The largest request body in bytes. */
  bodyBytes: 4 * 1024 * 1024,
} as const;

const outboxEventSchema = z.object({
  position: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  kind: z
    .string()
    .max(100)
    .regex(/^[a-z]+(\.[a-z]+)+$/u),
  id: z.string().min(1).max(PAGES_CORE_LIMITS.idLength),
  audience: z
    .object({
      projectId: z.string().min(1).max(PAGES_CORE_LIMITS.idLength),
      departmentId: z
        .string()
        .min(1)
        .max(PAGES_CORE_LIMITS.idLength)
        .nullable(),
    })
    .nullable(),
});

/**
 * One request of `pages-core`: browser sessions and committed outbox events.
 *
 * @remarks
 * An event names kind and object, never content. A session is the browser's
 * `Cookie` header; the API reads its session from it exactly as for a page
 * request, so the core never learns who is behind a stream.
 */
export const pagesCoreLiveRequestSchema = z.object({
  contract: z.literal(PAGES_CORE_CONTRACT_VERSION),
  sessions: z
    .array(
      z.object({
        key: z.string().min(1).max(PAGES_CORE_LIMITS.sessionKeyLength),
        cookie: z.string().max(PAGES_CORE_LIMITS.cookieLength),
      }),
    )
    .max(PAGES_CORE_LIMITS.sessions),
  events: z.array(outboxEventSchema).max(PAGES_CORE_LIMITS.events),
});

/** A validated request of `pages-core`. */
export type PagesCoreLiveRequest = z.infer<typeof pagesCoreLiveRequestSchema>;

/** One committed outbox event of a request. */
export type PagesCoreOutboxEvent = PagesCoreLiveRequest["events"][number];

/** What one session receives for one event; a hidden event has no entry. */
export type PagesCoreDecision =
  | {
      readonly position: number;
      readonly notice: "change";
      readonly change: LiveChange;
    }
  | {
      readonly position: number;
      readonly notice: "resync";
    };

/** The answer about one session. */
export type PagesCoreSessionAnswer =
  | {
      readonly key: string;
      readonly status: "active";
      /** The account's authorization fingerprint, as `/account-version` reports it. */
      readonly version: string;
      /**
       * A stable value of the session that names nobody: hex HMAC-SHA-256 of
       * the session id under `pagesCoreSecret`. The core binds the opaque
       * cursors of the session's streams to it, so a cursor only opens for the
       * session it was issued to.
       */
      readonly binding: string;
      readonly decisions: readonly PagesCoreDecision[];
    }
  | {
      readonly key: string;
      /** The session ended or must change its password; its streams close. */
      readonly status: "ended";
    };

/** The answer of `pages-api`: one entry per asked session. */
export interface PagesCoreLiveResponse {
  readonly contract: typeof PAGES_CORE_CONTRACT_VERSION;
  readonly sessions: readonly PagesCoreSessionAnswer[];
}

/**
 * The API path where `pages-core` asks whether a browser session may read
 * the detailed service status (PAGE-238).
 */
export const PAGES_CORE_STATUS_ACCESS_PATH = "/api/core/v1/status-access";

/**
 * One request of `pages-core`: may this browser session read the detailed
 * service status?
 *
 * @remarks
 * Like the live decisions, the session is the browser's `Cookie` header and
 * the API reads it as for a page request. The core asks again for every
 * detailed status request and keeps no answer.
 */
export const pagesCoreStatusAccessRequestSchema = z.object({
  contract: z.literal(PAGES_CORE_CONTRACT_VERSION),
  cookie: z.string().max(PAGES_CORE_LIMITS.cookieLength),
});

/** A validated status access request of `pages-core`. */
export type PagesCoreStatusAccessRequest = z.infer<
  typeof pagesCoreStatusAccessRequestSchema
>;

/**
 * The API's answer about the detailed service status.
 *
 * @remarks
 * `granted` only for an active session of an account in the active admin
 * mode, the same rule as the system settings. Every other answer, and no
 * answer in time, shows no details.
 */
export interface PagesCoreStatusAccessResponse {
  readonly contract: typeof PAGES_CORE_CONTRACT_VERSION;
  readonly access: "denied" | "granted";
}

/**
 * Headers of a Pica Mobile request that `pages-core` relays to the API's
 * relay listener (PAGE-239).
 *
 * @remarks
 * `secret` carries `Bearer <pagesCoreSecret>`; it is not `Authorization`,
 * which the app's attachment requests use for their session token. `client`
 * names the address the core accepted the app from, which the API's login
 * limit per address needs. The relay listener refuses a request without a
 * valid secret, without this contract version or without a client address,
 * and the core removes any copy of these headers a client sent.
 */
export const PAGES_CORE_RELAY_HEADERS = {
  secret: "x-pages-core-authorization",
  contract: "x-pages-core-contract",
  client: "x-pages-core-client",
} as const;
