import { isRole } from "@/definition/Role";

import type { Role } from "@/definition/Role";

/** Avatar presentation modes supported for a user. */
export const USER_AVATAR_TYPE = {
  INITIALS: "initials",
  ICON: "icon",
  IMAGE: "image",
} as const;

/** A presentation mode assigned to a user's avatar. */
export type UserAvatarType =
  (typeof USER_AVATAR_TYPE)[keyof typeof USER_AVATAR_TYPE];

/** Narrows an unknown value to a supported user avatar type. */
export function isUserAvatarType(value: unknown): value is UserAvatarType {
  return (
    typeof value === "string" &&
    (Object.values(USER_AVATAR_TYPE) as readonly string[]).includes(value)
  );
}

/**
 * A user as exposed to the client.
 *
 * @remarks
 * This shape never contains credentials or session data. Avatar values are
 * optional for compatibility with existing snapshots; the database uses the
 * initials fallback for every account unless a later profile change sets a
 * different value.
 */
export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly isActive: boolean;
  readonly avatarType?: UserAvatarType;
  readonly avatarIcon?: string | null;
  readonly avatarColor?: string | null;
  readonly avatarImageUrl?: string | null;
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

  if (
    candidate.avatarType !== undefined &&
    !isUserAvatarType(candidate.avatarType)
  ) {
    return false;
  }

  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.displayName === "string" &&
    isRole(candidate.role) &&
    typeof candidate.isActive === "boolean"
  );
}

/** Largest avatar image a user may upload, in bytes. */
export const MAXIMUM_AVATAR_BYTES = 5 * 1024 * 1024;

/** Image types accepted as avatar uploads. */
export const SUPPORTED_AVATAR_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Shape every stored email address has to match. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fewest characters a new password needs. */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** A user as listed in the directory, with what the viewer may do with them. */
export interface UserListItem extends User {
  readonly canManage: boolean;
  readonly email: string | null;
}
