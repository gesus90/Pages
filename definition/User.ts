import { isRole } from "@/definition/Role";

import type { Role } from "@/definition/Role";

/**
 * A user as exposed to the client.
 *
 * @remarks
 * This shape never contains credentials or session data.
 */
export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly isActive: boolean;
}

/**
 * Narrows unknown data to a user.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a user.
 */
export function isUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.displayName === "string" &&
    isRole(candidate.role) &&
    typeof candidate.isActive === "boolean"
  );
}
