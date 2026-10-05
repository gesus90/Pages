/**
 * Reads a form field that has to be text; empty text is accepted.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The text, or `null` when the field is missing or a file.
 */
export function readText(formData: FormData, key: string): string | null {
  const value = formData.get(key);

  return typeof value === "string" ? value : null;
}

/**
 * Reads a form field that has to be text and must not be empty.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The text, or `null` when the field is missing, empty, or a file.
 */
export function readRequiredText(
  formData: FormData,
  key: string,
): string | null {
  const value = readText(formData, key);

  return value === "" ? null : value;
}

/**
 * Reads an optional text field.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The text, or `null` when the field is missing or empty.
 */
export function readOptionalText(
  formData: FormData,
  key: string,
): string | null {
  return readRequiredText(formData, key);
}

/**
 * Reads a text field that defaults to an empty string.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The text, or an empty string when the field is missing.
 */
export function readTextOrEmpty(formData: FormData, key: string): string {
  return readOptionalText(formData, key) ?? "";
}

/**
 * Reads a text field with surrounding blanks removed.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The trimmed text, or `null` when nothing but blanks was entered.
 */
export function readTrimmedText(
  formData: FormData,
  key: string,
): string | null {
  return readTextOrEmpty(formData, key).trim() || null;
}
