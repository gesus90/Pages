import { EMAIL_PATTERN } from "@/definition/User";

import type {
  AccountCreateInput,
  AccountProfileInput,
} from "@/definition/Authorization";

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_USERNAME_LENGTH = 200;
const MAXIMUM_EMAIL_LENGTH = 320;

/** The validated fields of the create user form. */
export type CreateUserInput = AccountCreateInput;

/** The validated fields of the edit user form. */
export interface UpdateUserInput extends AccountProfileInput {
  readonly userId: string;
}

function getTrimmedString(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(formData: FormData, key: string): string | null {
  const trimmed = getTrimmedString(formData, key);

  return trimmed === "" ? null : trimmed;
}

/**
 * Reads the id of the user a form refers to.
 *
 * @param formData - The submitted form.
 * @returns The id as submitted, or `null` when it is missing or blank.
 */
export function readUserId(formData: FormData): string | null {
  const userId = formData.get("userId");

  return typeof userId === "string" && userId.trim() !== "" ? userId : null;
}

function isValidEmail(email: string): boolean {
  return email.length <= MAXIMUM_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

/**
 * Reads the create user form.
 *
 * @param formData - The submitted form.
 * @returns The input, or `null` when a field is missing, empty or too long.
 */
export function parseCreateUserInput(
  formData: FormData,
): CreateUserInput | null {
  const profile = readProfile(formData);
  if (!profile || !profile.firstName || !profile.lastName) {
    return null;
  }
  return {
    ...profile,
    roleId: getTrimmedString(formData, "role") || null,
    isAdmin: formData.get("isAdmin") === "true",
    departments: formData
      .getAll("department")
      .filter((entry): entry is string => typeof entry === "string"),
  };
}

function readProfile(formData: FormData): AccountProfileInput | null {
  const firstName = getTrimmedString(formData, "firstName");
  const lastName = getTrimmedString(formData, "lastName");
  const username = getTrimmedString(formData, "username");
  const email = normalizeEmail(formData, "email");
  if (
    (!firstName && !lastName) ||
    !username ||
    firstName.length > MAXIMUM_NAME_LENGTH ||
    lastName.length > MAXIMUM_NAME_LENGTH ||
    username.length > MAXIMUM_USERNAME_LENGTH ||
    (email !== null && !isValidEmail(email))
  ) {
    return null;
  }
  return { firstName, lastName, username, email };
}

/**
 * Reads the edit user form.
 *
 * @param formData - The submitted form.
 * @returns The input, or `null` when a field is missing, empty or too long.
 */
export function parseUpdateUserInput(
  formData: FormData,
): UpdateUserInput | null {
  const userId = readUserId(formData);
  const profile = readProfile(formData);
  if (userId === null || !profile) {
    return null;
  }
  return { ...profile, userId };
}
