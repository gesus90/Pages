import type {
  PicaMobileAvatarPayload,
  PicaMobileDashboardPayload,
} from "@/definition/PicaMobileProtocol";

/** The account and session an authenticated connection is bound to. */
export interface PicaMobileSessionIdentity {
  readonly userId: string;
  readonly sessionToken: string;
}

/**
 * The answer to a dashboard read.
 *
 * @remarks
 * `sessionEnded` means the session or the account no longer holds; the
 * connection ends as it does when its regular session check fails.
 */
export type PicaMobileDashboardOutcome =
  | { readonly kind: "ready"; readonly dashboard: PicaMobileDashboardPayload }
  | { readonly kind: "sessionEnded" };

/**
 * The answer to an avatar read.
 *
 * @remarks
 * `notFound` covers a missing or unusable image and a version that is not the
 * current one any more.
 */
export type PicaMobileAvatarOutcome =
  | { readonly kind: "ready"; readonly avatar: PicaMobileAvatarPayload }
  | { readonly kind: "notFound" }
  | { readonly kind: "sessionEnded" };

/**
 * The business answers of an authenticated Pica Mobile connection.
 *
 * @remarks
 * A connection that has no provider does not announce `dashboard.v1` and
 * answers the dashboard messages as unknown. Every call decides from the
 * current rights of the account behind the session, never from earlier answers.
 */
export interface PicaMobileDashboardProvider {
  /** Reads the dashboard of the account; rejects only when Pages cannot decide right now. */
  readDashboard(
    session: PicaMobileSessionIdentity,
  ): Promise<PicaMobileDashboardOutcome>;
  /** Reads the current avatar of the account when it still has the given version. */
  readAvatar(
    session: PicaMobileSessionIdentity,
    version: string,
  ): Promise<PicaMobileAvatarOutcome>;
}
