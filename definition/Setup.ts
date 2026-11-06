import { EMAIL_PATTERN, MINIMUM_PASSWORD_LENGTH } from "@/definition/User";

/**
 * Results of checking the PostgreSQL connection used by the setup wizard.
 */
export const DATABASE_LOCATION_STATUS = {
  /** No connection was entered. */
  EMPTY: "empty",
  /** The text is not a PostgreSQL connection URL. */
  INVALID: "invalid",
  /** The database cannot be reached or access was refused. */
  NOT_WRITABLE: "notWritable",
  /** Reserved for an existing database. */
  EXISTING: "existing",
  /** The database contains objects and must not be overwritten. */
  FOREIGN: "foreign",
  /** The public schema is empty and reachable. */
  AVAILABLE: "available",
} as const;

/** The outcome of a database path check. */
export type DatabaseLocationStatus =
  (typeof DATABASE_LOCATION_STATUS)[keyof typeof DATABASE_LOCATION_STATUS];

/**
 * Tells whether setup may continue with a checked database connection.
 *
 * @param status - Outcome of the check.
 * @returns Whether the chosen database is empty.
 */
export function canUseDatabaseLocation(
  status: DatabaseLocationStatus,
): boolean {
  return status === DATABASE_LOCATION_STATUS.AVAILABLE;
}

/** Longest company name the setup accepts. */
export const MAXIMUM_COMPANY_NAME_LENGTH = 200;

/** Longest username the setup accepts, as in the user directory. */
export const MAXIMUM_USERNAME_LENGTH = 200;

/** Longest password the setup accepts, as in the user directory. */
export const MAXIMUM_PASSWORD_LENGTH = 1000;

/** Longest email address the setup accepts, as in the user directory. */
export const MAXIMUM_EMAIL_LENGTH = 320;

/** Longest database URL the setup accepts. */
export const MAXIMUM_DATABASE_URL_LENGTH = 4096;

/** Fields of the setup wizard that can be rejected. */
export type SetupField =
  "companyName" | "username" | "password" | "email" | "databaseUrl";

/** Why a setup field was rejected. */
export type SetupFieldError =
  | "required"
  | "tooLong"
  | "tooShort"
  | "invalidEmail"
  | "usernameTaken"
  | "emailTaken";

/** Rejected fields of a submitted setup. */
export type SetupFieldErrors = Readonly<
  Partial<Record<SetupField, SetupFieldError>>
>;

/** Account and company values of the wizard as entered. */
export interface SetupFieldValues {
  readonly companyName: string;
  readonly username: string;
  readonly password: string;
  readonly email: string;
}

function checkRequiredText(
  value: string,
  maximumLength: number,
): SetupFieldError | null {
  if (value.trim() === "" || value.includes("\u0000")) {
    return "required";
  }

  return value.trim().length > maximumLength ? "tooLong" : null;
}

function checkPassword(password: string): SetupFieldError | null {
  if (password === "") {
    return "required";
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return "tooShort";
  }

  return password.length > MAXIMUM_PASSWORD_LENGTH ? "tooLong" : null;
}

function checkEmail(email: string): SetupFieldError | null {
  const trimmed = email.trim();

  if (trimmed === "") {
    return null;
  }

  return trimmed.length > MAXIMUM_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)
    ? "invalidEmail"
    : null;
}

/**
 * Checks the company and account values of the setup wizard.
 *
 * @param values - Values as entered; surrounding blanks do not count.
 * @returns The error of each rejected field; empty when all are valid.
 *
 * @remarks
 * The rules match the user directory: company name and username up to 200
 * characters, a password of 8 to 1000 characters, and an optional email
 * address. The server applies them to every submitted setup; the wizard
 * uses them only to point out mistakes early.
 */
export function validateSetupFields(
  values: SetupFieldValues,
): SetupFieldErrors {
  const errors: [SetupField, SetupFieldError | null][] = [
    [
      "companyName",
      checkRequiredText(values.companyName, MAXIMUM_COMPANY_NAME_LENGTH),
    ],
    ["username", checkRequiredText(values.username, MAXIMUM_USERNAME_LENGTH)],
    ["password", checkPassword(values.password)],
    ["email", checkEmail(values.email)],
  ];

  return Object.fromEntries(errors.filter(([, error]) => error !== null));
}
