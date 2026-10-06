import { AdministrationError } from "@/backend/error/AdministrationError";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess, Department } from "@/definition/Authorization";

/** Resolves a target from the current aggregate snapshot. */
export function findAccount(
  snapshot: AuthorizationSnapshot,
  userId: string,
): AccountAccess {
  const account = snapshot.accounts.find(
    (candidate) => candidate.userId === userId,
  );
  if (!account) throw new AdministrationError("notFound");
  return account;
}

/** Requires a current active actor, never client-supplied authorization facts. */
export function activeAccount(
  snapshot: AuthorizationSnapshot,
  userId: string,
): AccountAccess {
  const account = findAccount(snapshot, userId);
  requireAdministration(account.isActive);
  return account;
}

/** Translates a failed management policy into the shared domain error. */
export function requireAdministration(allowed: boolean): void {
  if (!allowed) throw new AdministrationError("forbidden");
}

/** Validates bounded, nonempty names at the service boundary. */
export function validateAdministrationName(name: string): void {
  if (name.trim().length === 0 || name.length > 200)
    throw new AdministrationError("invalidInput");
}

/** Rejects conflicting catalog names without altering an existing record. */
export function requireUniqueAdministrationName(
  records: readonly Department[],
  input: Department,
): void {
  if (
    records.some(
      (record) =>
        record.id !== input.id &&
        record.name.toLowerCase() === input.name.trim().toLowerCase(),
    )
  ) {
    throw new AdministrationError("invalidInput");
  }
}
