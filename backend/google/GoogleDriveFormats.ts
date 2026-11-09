/** The Drive folder type. */
export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Google's own document types, which carry no bytes and are only exported. */
export const GOOGLE_DOCUMENT_MIME_TYPES = {
  document: "application/vnd.google-apps.document",
  drawing: "application/vnd.google-apps.drawing",
  presentation: "application/vnd.google-apps.presentation",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
} as const;

/**
 * The export formats Pages supports per Google document type (PAGE-270).
 *
 * @remarks
 * A subset of the formats Drive's `about.get` lists; other Google types such
 * as forms, sites or shortcuts have no supported export and are refused.
 */
export const GOOGLE_EXPORT_FORMATS: Readonly<
  Record<string, readonly string[]>
> = {
  [GOOGLE_DOCUMENT_MIME_TYPES.document]: [
    "text/plain",
    "text/markdown",
    "text/html",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [GOOGLE_DOCUMENT_MIME_TYPES.spreadsheet]: [
    "text/csv",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [GOOGLE_DOCUMENT_MIME_TYPES.presentation]: [
    "text/plain",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  [GOOGLE_DOCUMENT_MIME_TYPES.drawing]: [
    "image/svg+xml",
    "image/png",
    "application/pdf",
  ],
};

/** The format `read` uses for a Google document when the caller names none. */
export const GOOGLE_READ_FORMATS: Readonly<Record<string, string>> = {
  [GOOGLE_DOCUMENT_MIME_TYPES.document]: "text/plain",
  [GOOGLE_DOCUMENT_MIME_TYPES.spreadsheet]: "text/csv",
  [GOOGLE_DOCUMENT_MIME_TYPES.presentation]: "text/plain",
  [GOOGLE_DOCUMENT_MIME_TYPES.drawing]: "image/svg+xml",
};

/**
 * Tells whether a type is one of Google's own types, which have no bytes.
 *
 * @param mimeType - The Drive type.
 * @returns Whether it starts with `application/vnd.google-apps.` and is no folder.
 */
export function isGoogleAppsType(mimeType: string): boolean {
  return (
    mimeType.startsWith("application/vnd.google-apps.") &&
    mimeType !== DRIVE_FOLDER_MIME_TYPE
  );
}
