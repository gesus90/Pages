import { readText } from "@/app/lib/form-fields.server";
import { validateSetupFields } from "@/definition/Setup";

import { SETUP_FORM_FIELD } from "./setup-action-data";

import type { SetupFieldErrors } from "@/definition/Setup";

/** The validated fields of a submitted setup. */
export interface SetupFormInput {
  readonly companyName: string;
  readonly username: string;
  readonly password: string;
  readonly email: string | null;
  readonly databasePath: string;
}

/** The outcome of reading a submitted setup. */
export type SetupFormResult =
  | { readonly isValid: true; readonly input: SetupFormInput }
  | { readonly isValid: false; readonly fieldErrors: SetupFieldErrors };

/**
 * Reads and validates every field of a submitted setup.
 *
 * @param formData - The submitted wizard form.
 * @returns The trimmed input, or the error of each rejected field.
 *
 * @remarks
 * The whole form is checked, whichever step the wizard showed last. The
 * database path is checked separately against the file system.
 */
export function readSetupForm(formData: FormData): SetupFormResult {
  const values = {
    companyName: readText(formData, SETUP_FORM_FIELD.COMPANY_NAME) ?? "",
    email: readText(formData, SETUP_FORM_FIELD.EMAIL) ?? "",
    password: readText(formData, SETUP_FORM_FIELD.PASSWORD) ?? "",
    username: readText(formData, SETUP_FORM_FIELD.USERNAME) ?? "",
  };
  const fieldErrors = validateSetupFields(values);

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, isValid: false };
  }

  return {
    input: {
      companyName: values.companyName.trim(),
      databasePath: readText(formData, SETUP_FORM_FIELD.DATABASE_PATH) ?? "",
      email: values.email.trim() || null,
      password: values.password,
      username: values.username.trim(),
    },
    isValid: true,
  };
}
