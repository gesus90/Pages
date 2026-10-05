import { ROLE, isRole } from "@/definition/Role";
import { EMAIL_PATTERN, MINIMUM_PASSWORD_LENGTH } from "@/definition/User";

import type { Role } from "@/definition/Role";

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_USERNAME_LENGTH = 200;
const MAXIMUM_EMAIL_LENGTH = 320;
const MAXIMUM_PASSWORD_LENGTH = 1000;

/** The validated fields of the create user form. */
export interface CreateUserInput {
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
  readonly password: string;
  readonly role: Role;
}

/** The validated fields of the edit user form. */
export interface UpdateUserInput {
  readonly userId: string;
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
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
 * @param actorRole - Role of the user creating the account; only administrators
 * choose a role, everybody else creates employees.
 * @returns The input, or `null` when a field is missing, empty or too long.
 */
export function parseCreateUserInput(
  formData: FormData,
  actorRole: Role,
): CreateUserInput | null {
  const displayName = getTrimmedString(formData, "displayName");
  const username = getTrimmedString(formData, "username");
  const password = formData.get("password");
  const requestedRole = formData.get("role");
  const email = normalizeEmail(formData, "email");

  if (
    !displayName ||
    !username ||
    typeof password !== "string" ||
    password.length < MINIMUM_PASSWORD_LENGTH ||
    password.length > MAXIMUM_PASSWORD_LENGTH
  ) {
    return null;
  }

  if (
    displayName.length > MAXIMUM_NAME_LENGTH ||
    username.length > MAXIMUM_USERNAME_LENGTH
  ) {
    return null;
  }

  if (email !== null && !isValidEmail(email)) {
    return null;
  }

  return {
    displayName,
    email,
    password,
    role:
      actorRole === ROLE.ADMIN && isRole(requestedRole)
        ? requestedRole
        : ROLE.EMPLOYEE,
    username,
  };
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
  const displayName = getTrimmedString(formData, "displayName");
  const username = getTrimmedString(formData, "username");
  const email = normalizeEmail(formData, "email");

  if (userId === null || !displayName || !username) {
    return null;
  }

  if (
    displayName.length > MAXIMUM_NAME_LENGTH ||
    username.length > MAXIMUM_USERNAME_LENGTH
  ) {
    return null;
  }

  if (email !== null && !isValidEmail(email)) {
    return null;
  }

  return { displayName, email, userId, username };
}
