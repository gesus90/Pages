import { EMAIL_PATTERN } from "@/definition/User";

import type { ProfileDraft } from "@/app/components/settings/profile-edit-form";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

/** The cleaned profile values that are submitted to the server. */
export interface ProfileInput {
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  readonly role: Role;
}

/** Removes the leading `@` the form shows in front of the username. */
function cleanUsername(username: string): string {
  return (username.startsWith("@") ? username.slice(1) : username).trim();
}

/**
 * Creates the editable profile values a user starts an edit from.
 *
 * @param user - The user whose profile is edited.
 * @param email - The stored email address, or `null` when there is none.
 */
export function createProfileDraft(
  user: User,
  email: string | null,
): ProfileDraft {
  return {
    displayName: user.displayName,
    email: email ?? "",
    role: user.role,
    username: `@${user.username}`,
  };
}

/**
 * Tells whether the draft differs from the stored profile.
 *
 * @param draft - The values the administrator is editing.
 * @param user - The user whose profile is edited.
 * @param email - The stored email address, or `null` when there is none.
 */
export function hasProfileChanges(
  draft: ProfileDraft,
  user: User,
  email: string | null,
): boolean {
  return (
    draft.displayName.trim() !== user.displayName.trim() ||
    cleanUsername(draft.username) !== user.username.trim() ||
    draft.email.trim() !== (email ?? "").trim() ||
    draft.role !== user.role
  );
}

/**
 * Cleans the draft and checks that it may be submitted.
 *
 * @param draft - The values the administrator is editing.
 * @returns The cleaned values, or `null` when a required value is missing or
 * the email address is malformed.
 */
export function parseProfileDraft(draft: ProfileDraft): ProfileInput | null {
  const displayName = draft.displayName.trim();
  const username = cleanUsername(draft.username);
  const email = draft.email.trim();

  if (!displayName || !username) {
    return null;
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return { displayName, email, role: draft.role, username };
}
