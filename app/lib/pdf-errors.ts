/**
 * Tells whether pdf.js refused a PDF because it is protected by a password.
 * Pages never asks for the password; the file stays downloadable.
 * @remarks
 * Kept apart from `pdf-preview`, so a viewer can tell the reason without
 * loading pdf.js and its worker for it.
 * @param error - What opening the PDF threw.
 */
export function isPdfPasswordError(error: unknown): boolean {
  return error instanceof Error && error.name === "PasswordException";
}
