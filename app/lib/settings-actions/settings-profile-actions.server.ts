import { data } from "react-router";

import { ROLE, isRole } from "@/definition/Role";
import { EMAIL_PATTERN, USER_AVATAR_TYPE } from "@/definition/User";

import { parseAvatarUpload } from "./avatar-upload.server";
import { forbidden } from "./settings-action-support.server";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { AvatarUpload } from "./avatar-upload.server";
import type {
  ProfileUpdateErrorCode,
  SettingsActionData,
  SettingsActionHandler,
  SettingsActionResult,
} from "./settings-action-support.server";
import type { Role } from "@/definition/Role";
import type { ApplicationServices } from "@/app/lib/services.server";

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_EMAIL_LENGTH = 320;

/** The values of the personal profile form, validated. */
interface ProfileForm {
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
  readonly role: Role;
}

/** Statuses of the profile failures that are not plain bad input. */
const PROFILE_ERROR_STATUS: Record<ProfileUpdateErrorCode, number> = {
  emailTaken: 400,
  forbidden: 403,
  general: 400,
  invalidAvatar: 400,
  invalidInput: 400,
  lastAdministrator: 409,
  usernameTaken: 400,
};

function profileFailure(error: ProfileUpdateErrorCode): SettingsActionResult {
  return data<SettingsActionData>(
    { intent: "update-profile", ok: false, error },
    { status: PROFILE_ERROR_STATUS[error] },
  );
}

/** Tells which profile error a failed update is, so the form can explain it. */
function toProfileErrorCode(error: unknown): ProfileUpdateErrorCode {
  if (error instanceof UsernameTakenError) {
    return "usernameTaken";
  }

  if (error instanceof EmailTakenError) {
    return "emailTaken";
  }

  if (error instanceof LastAdministratorError) {
    return "lastAdministrator";
  }

  if (
    error instanceof UserManagementDeniedError ||
    error instanceof RoleAssignmentDeniedError
  ) {
    return "forbidden";
  }

  return "general";
}

/**
 * Reads the personal profile form.
 *
 * @returns The trimmed values, or `null` when a field is missing, empty, too
 * long, or the email address is malformed.
 */
function readProfileForm(formData: FormData): ProfileForm | null {
  const displayName = formData.get("displayName");
  const rawUsername = formData.get("username");
  const rawEmail = formData.get("email");
  const role = formData.get("role");

  if (
    typeof displayName !== "string" ||
    typeof rawUsername !== "string" ||
    !isRole(role)
  ) {
    return null;
  }

  const trimmedDisplayName = displayName.trim();
  const username = (
    rawUsername.startsWith("@") ? rawUsername.slice(1) : rawUsername
  ).trim();
  const email =
    typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim() : null;
  const hasValidNames =
    trimmedDisplayName !== "" &&
    trimmedDisplayName.length <= MAXIMUM_NAME_LENGTH &&
    username !== "" &&
    username.length <= MAXIMUM_NAME_LENGTH;
  const hasValidEmail =
    email === null ||
    (email.length <= MAXIMUM_EMAIL_LENGTH && EMAIL_PATTERN.test(email));

  return hasValidNames && hasValidEmail
    ? { displayName: trimmedDisplayName, email, role, username }
    : null;
}

/** Stores an uploaded image as the avatar of a user. */
async function storeAvatar(
  services: ApplicationServices,
  userId: string,
  avatar: AvatarUpload,
): Promise<void> {
  await services.userService.updateOwnAvatar(userId, {
    ...avatar,
    avatarImageUrl: `/users/${userId}/avatar?v=${Date.now()}`,
    avatarType: USER_AVATAR_TYPE.IMAGE,
  });
}

/** Changes the personal profile; only administrators may do this. */
export const handleUpdateProfile: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  // Text and role changes are an administrative operation, even when an
  // administrator edits their own profile. Ordinary users are rejected here
  // instead of trusting the hidden client-side edit button.
  if (user.role !== ROLE.ADMIN) {
    throw forbidden();
  }

  const profile = readProfileForm(formData);

  if (!profile) {
    return profileFailure("invalidInput");
  }

  const avatarUpload = await parseAvatarUpload(formData.get("avatar"));

  if (avatarUpload.status === "invalid") {
    return profileFailure("invalidAvatar");
  }

  if (avatarUpload.status === "ready") {
    await storeAvatar(services, user.id, avatarUpload.avatar);
  }

  try {
    await services.userService.updateOwnProfile(user, profile);

    return data<SettingsActionData>({ intent: "update-profile", ok: true });
  } catch (error: unknown) {
    return profileFailure(toProfileErrorCode(error));
  }
};

/** Replaces the avatar image; open to every signed-in user. */
export const handleUpdateAvatar: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  // The avatar is the only personal value an ordinary user may change about
  // themselves, so this intent stays open to every authenticated user.
  const avatarUpload = await parseAvatarUpload(formData.get("avatar"));

  if (avatarUpload.status !== "ready") {
    return data<SettingsActionData>(
      {
        intent: "update-avatar",
        ok: false,
        error:
          avatarUpload.status === "missing" ? "invalidInput" : "invalidAvatar",
      },
      { status: 400 },
    );
  }

  try {
    await storeAvatar(services, user.id, avatarUpload.avatar);

    return data<SettingsActionData>({ intent: "update-avatar", ok: true });
  } catch {
    return data<SettingsActionData>(
      { intent: "update-avatar", ok: false, error: "general" },
      { status: 400 },
    );
  }
};
