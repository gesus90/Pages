import { EMAIL_PATTERN, MINIMUM_PASSWORD_LENGTH } from "@/definition/User";

/**
 * Results of checking the database path the setup wizard should use, in
 * the order the check runs.
 */
export const DATABASE_LOCATION_STATUS = {
  /** No path was entered. */
  EMPTY: "empty",
  /** The text is no absolute path of a `.duckdb` file. */
  INVALID: "invalid",
  /** The directory is missing or Pages cannot write there. */
  NOT_WRITABLE: "notWritable",
  /** A Pages database is there; the setup opens it and keeps its data. */
  EXISTING: "existing",
  /** Another file is there; Pages never overwrites it. */
  FOREIGN: "foreign",
  /** Nothing is there and Pages can create the database. */
  AVAILABLE: "available",
} as const;

/** The outcome of a database path check. */
export type DatabaseLocationStatus =
  (typeof DATABASE_LOCATION_STATUS)[keyof typeof DATABASE_LOCATION_STATUS];

/**
 * Tells whether the setup may continue with a checked database path.
 *
 * @param status - Outcome of the check.
 * @returns Whether a new database can be created or an existing Pages
 * database opened there.
 */
export function canUseDatabaseLocation(
  status: DatabaseLocationStatus,
): boolean {
  return (
    status === DATABASE_LOCATION_STATUS.AVAILABLE ||
    status === DATABASE_LOCATION_STATUS.EXISTING
  );
}

/** Longest company name the setup accepts. */
export const MAXIMUM_COMPANY_NAME_LENGTH = 200;

/** Longest username the setup accepts, as in the user directory. */
export const MAXIMUM_USERNAME_LENGTH = 200;

/** Longest password the setup accepts, as in the user directory. */
export const MAXIMUM_PASSWORD_LENGTH = 1000;

/** Longest email address the setup accepts, as in the user directory. */
export const MAXIMUM_EMAIL_LENGTH = 320;

/** Longest database path the setup accepts. */
export const MAXIMUM_DATABASE_PATH_LENGTH = 4096;

/** Fields of the setup wizard that can be rejected. */
export type SetupField =
  "companyName" | "username" | "password" | "email" | "databasePath";

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
  if (value.trim() === "") {
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
