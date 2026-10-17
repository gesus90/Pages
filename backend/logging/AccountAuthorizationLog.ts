import { AsyncLocalStorage } from "node:async_hooks";

import { logEvent } from "./Logger";

interface AuthorizationVersion {
  readonly userId: string;
  readonly version: string;
}

interface AuthorizationDelivery {
  version: AuthorizationVersion | null;
}

const MAXIMUM_ACCOUNTS = 4_096;
const versions = new Map<string, string>();
const scope = new AsyncLocalStorage<AuthorizationDelivery>();

function completeDelivery(delivery: AuthorizationDelivery): void {
  const observation = delivery.version;
  delivery.version = null;
  if (observation === null) return;
  const { userId, version } = observation;
  const previous = versions.get(userId);
  versions.delete(userId);
  versions.set(userId, version);
  if (versions.size > MAXIMUM_ACCOUNTS) {
    const oldest = versions.keys().next().value;
    if (oldest !== undefined) versions.delete(oldest);
  }
  if (previous === undefined || previous === version) return;
  logEvent({
    level: "info",
    event: "account.authorization.changed",
    component: "AccountAuthorization",
    message: "Delivered account authorization version changed",
    metadata: { userId },
  });
}

/** Confirms a pending version only when the HTTP observer reports successful delivery. */
export function withAccountAuthorizationLog<Result>(
  work: (confirm: () => void) => Result,
): Result {
  const delivery: AuthorizationDelivery = { version: null };
  return scope.run(delivery, () => work(() => completeDelivery(delivery)));
}

/** Stages the existing authorization fingerprint privately; no value enters any log payload. */
export function recordAccountAuthorizationVersion(
  userId: string,
  version: string,
): void {
  const delivery = scope.getStore();
  if (delivery) delivery.version = { userId, version };
}
