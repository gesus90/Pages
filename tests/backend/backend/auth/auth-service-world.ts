import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";

import { SessionWorld } from "./session-service-world";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";

/** Failures a username may collect before the throttle blocks it. */
export const USERNAME_FAILURE_LIMIT = 3;

/** Failures an address may collect before the throttle blocks it. */
export const ADDRESS_FAILURE_LIMIT = 5;

/** Length of the throttle window. */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * The authentication service over in-memory users and sessions.
 *
 * @remarks
 * The hasher is the deterministic stub of the account world, so verification
 * costs nothing and calls on it can be counted.
 */
export class AuthWorld {
  public readonly sessionWorld = new SessionWorld();
  public readonly clock = { now: 1_000_000 };
  public readonly hasher: PasswordHasher = this.sessionWorld.accounts.hasher;
  public readonly service: AuthService;

  /** Builds the service with a throttle that follows the test clock. */
  public constructor() {
    this.service = new AuthService(
      this.sessionWorld.users,
      this.sessionWorld.sessions,
      this.hasher,
      new LoginThrottle({
        windowMs: THROTTLE_WINDOW_MS,
        maxFailuresPerUsername: USERNAME_FAILURE_LIMIT,
        maxFailuresPerAddress: ADDRESS_FAILURE_LIMIT,
        now: () => this.clock.now,
      }),
    );
  }
}
