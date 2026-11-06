import { localState } from "./local-state-store";

/** Whom the server answered and under which authorization fingerprint. */
export interface LocalStateAudience {
  readonly userId: string;
  /** The fingerprint of the account's rights the page shell also compares. */
  readonly authorizationVersion: string;
}

/** Tells the other tabs of this browser which fingerprint a shell was loaded with. */
const AUDIENCE_CHANNEL = "pages-local-state-audience";

let currentAudience: LocalStateAudience | null = null;
let channel: BroadcastChannel | null = null;
const changeListeners = new Set<() => void>();
let settleAudience: (() => void) | null = null;
/** Settles once the shell named its fingerprint, or could not (PAGE-235). */
const firstAudience = new Promise<void>((resolve) => {
  settleAudience = resolve;
});

/**
 * Whether a value is an audience as the server sends it.
 *
 * @param value - The value to check.
 */
export function isLocalStateAudience(
  value: unknown,
): value is LocalStateAudience {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof value.userId === "string" &&
    "authorizationVersion" in value &&
    typeof value.authorizationVersion === "string"
  );
}

/** Removes kept answers given to the account under other rights than the current ones. */
function forgetOtherAudiences(current: LocalStateAudience): Promise<void> {
  return localState.removeOutdated(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "audience" in payload &&
      isLocalStateAudience(payload.audience) &&
      (payload.audience.userId !== current.userId ||
        payload.audience.authorizationVersion !== current.authorizationVersion),
  );
}

/**
 * Forgets this tab's fingerprint when another tab of the same account was loaded with another one.
 *
 * @remarks
 * Its rights changed, for example the admin mode on another tab. No kept
 * answer applies until this tab's shell was loaded again; the listeners
 * load it. Another account is the local state's concern, see `claim`.
 */
function receiveAudience(audience: unknown): void {
  if (!isLocalStateAudience(audience) || currentAudience === null) return;
  if (audience.userId !== currentAudience.userId) return;
  if (audience.authorizationVersion === currentAudience.authorizationVersion)
    return;
  currentAudience = null;
  void forgetOtherAudiences(audience);
  for (const listener of changeListeners) listener();
}

/**
 * Records the signed-in account and fingerprint the page shell was loaded with.
 *
 * @remarks
 * The other tabs of the browser learn it at once, so a change of rights in
 * one tab never leaves a kept answer of the earlier rights shown in another.
 *
 * @param audience - The account and fingerprint of the shell's last answer.
 */
export function rememberLocalStateAudience(audience: LocalStateAudience): void {
  currentAudience = audience;
  settleAudience?.();
  void forgetOtherAudiences(audience);
  if (typeof BroadcastChannel === "undefined") return;
  if (!channel) {
    channel = new BroadcastChannel(AUDIENCE_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) =>
      receiveAudience(event.data);
  }
  channel.postMessage(audience);
}

/**
 * Resolves once the shell named the fingerprint of its first answer, or could not.
 *
 * @remarks
 * The static app opens without server rendering (PAGE-235): a route's loader
 * runs before the shell is shown, so it waits for the shell's loader before
 * it decides whether a kept answer still applies.
 */
export function whenLocalStateAudienceSettled(): Promise<void> {
  return firstAudience;
}

/**
 * Lets the routes go on although the shell named no fingerprint, such as after
 * a redirect to the sign-in page; no kept answer then applies.
 */
export function settleWithoutLocalStateAudience(): void {
  settleAudience?.();
}

/**
 * Calls the listener when another tab of the account was loaded with other rights.
 *
 * @param listener - Loads this tab's shell again.
 * @returns Stops calling the listener.
 */
export function onLocalStateAudienceChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Whether a kept answer was given to the signed-in account under its current rights.
 *
 * @remarks
 * A kept answer of another account or of earlier rights is not shown, so a
 * revoked right never stays visible from the browser's local state. Before
 * the shell named its fingerprint no kept answer applies, and none applies
 * once another tab signed out or signed in as another account.
 *
 * @param audience - Whom the kept answer was given to.
 */
export function isCurrentLocalStateAudience(
  audience: LocalStateAudience,
): boolean {
  return (
    currentAudience !== null &&
    !localState.isSuperseded() &&
    localState.currentOwner() === audience.userId &&
    currentAudience.userId === audience.userId &&
    currentAudience.authorizationVersion === audience.authorizationVersion
  );
}
