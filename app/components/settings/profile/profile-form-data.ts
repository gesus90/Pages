import type { ProfileInput } from "@/app/components/settings/profile/profile-draft";

/**
 * Builds the submission of a profile edit.
 *
 * @param input - The cleaned profile values.
 * @param avatar - The picked avatar file, or `null` to keep the avatar.
 */
export function createProfileFormData(
  input: ProfileInput,
  avatar: File | null,
): FormData {
  const formData = new FormData();

  formData.set("intent", "update-profile");
  formData.set("displayName", input.displayName);
  formData.set("username", input.username);
  formData.set("email", input.email);
  formData.set("role", input.role);

  if (avatar) {
    formData.set("avatar", avatar);
  }

  return formData;
}

/**
 * Builds the submission that only replaces the avatar.
 *
 * @param avatar - The picked avatar file.
 */
export function createAvatarFormData(avatar: File): FormData {
  const formData = new FormData();

  formData.set("intent", "update-avatar");
  formData.set("avatar", avatar);

  return formData;
}
