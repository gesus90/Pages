import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";

/** Fixed diagnoses that never contain request content or exception text. */
export type LocalControlCode =
  "stale_attachment" | "native_cleanup_unconfirmed" | "internal";

/** A local protocol rejection with a fixed, safe diagnosis. */
export class LocalControlFailure extends Error {
  public readonly code: LocalControlCode;

  public constructor(code: LocalControlCode) {
    super(code);
    this.code = code;
  }
}

/** A failed command of a proven owner, retaining only its validated diagnosis. */
export class LocalControlCommandError extends AgentError {
  public readonly detail: string;

  public constructor(code: string) {
    super("plan_local_control_failed");
    this.detail = safeLocalControlCode(code);
  }
}

/** Accepts only product-defined codes within the protocol's length and syntax limits. */
export function safeLocalControlCode(code: unknown): string {
  if (typeof code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(code))
    return "internal";
  return isAgentErrorCode(code) ||
    code === "stale_attachment" ||
    code === "native_cleanup_unconfirmed"
    ? code
    : "internal";
}

/** Translates errors without reading or emitting their message, stack or arbitrary properties. */
export function localControlFailureCode(error: unknown): string {
  return error instanceof AgentError || error instanceof LocalControlFailure
    ? safeLocalControlCode(error.code)
    : "internal";
}
