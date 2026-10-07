/** Largest company logo an administrator may upload, in bytes. */
export const MAXIMUM_LOGO_BYTES = 2 * 1024 * 1024;

/** Image types accepted as company logo uploads. */
export const SUPPORTED_LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

/** The company name and logo as every visitor sees them. */
export interface InstanceBranding {
  readonly companyName: string | null;
  /** Address of the logo, or `null` when none was uploaded. */
  readonly logoUrl: string | null;
}

/** Where Pages serves the company logo, without a session. */
export const INSTANCE_LOGO_PATH = "/instance-logo";
