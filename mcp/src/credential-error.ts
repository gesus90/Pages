/** Fixed, safe diagnostic for local persistence failures. */
export class CredentialStoreError extends Error {
  public constructor(
    message = "Could not use credentials.json. Check its directory (0700) and file (0600) permissions.",
  ) {
    super(message);
  }
}
