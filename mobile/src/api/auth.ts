/**
 * Supplies the credentials of a request.
 *
 * @remarks
 * The foundation sends no credentials. The later authentication ticket provides
 * an implementation backed by the device's credential store; the client already
 * asks it before every request, so no call site changes.
 */
export interface AuthProvider {
  /** The value of the `Authorization` header, or `null` for an anonymous request. */
  getAuthorizationHeader(): Promise<string | null>;
}

/** Sends every request without credentials. */
export const ANONYMOUS_AUTH: AuthProvider = {
  getAuthorizationHeader: () => Promise.resolve(null),
};
