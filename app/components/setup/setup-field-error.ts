import type { TFunction } from "i18next";
import type { SetupFieldError } from "@/definition/Setup";

/**
 * Returns the message of a rejected wizard field.
 *
 * @param t - Translation function of the current language.
 * @param error - Why the field was rejected, if it was.
 * @returns The message, or `null` for an accepted field.
 */
export function describeSetupFieldError(
  t: TFunction,
  error: SetupFieldError | undefined,
): string | null {
  return error === undefined ? null : t(`setup.fieldError.${error}`);
}
