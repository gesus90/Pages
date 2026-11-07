import type { McpDeviceErrorCode } from "@/definition/McpDevice";

/** Fixed public failure of the device API; it carries a code and a status, never a diagnosis. */
export class McpDeviceError extends Error {
  public readonly code: McpDeviceErrorCode;
  public readonly status: number;
  /** Seconds a client waits before it asks again; set with `429`. */
  public readonly retryAfterSeconds: number | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface.
   * @param status - The HTTP status of the answer.
   * @param retryAfterSeconds - Seconds to wait, for an answer with `Retry-After`.
   */
  public constructor(
    code: McpDeviceErrorCode,
    status = 400,
    retryAfterSeconds: number | null = null,
  ) {
    super("The device request was rejected.");
    this.name = "McpDeviceError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
