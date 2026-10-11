/** Fixed public failure that never includes submitted credentials or provider diagnostics. */
export class McpAuthorizationError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, status = 400) {
    super("The authorization request was rejected.");
    this.code = code;
    this.status = status;
  }
}
