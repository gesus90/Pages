import type { DiscordActionErrorCode } from "@/definition/Discord";

/** Reasons a Discord operation of a project is refused. */
export type DiscordErrorCode = Exclude<
  DiscordActionErrorCode,
  "invalid_input" | "forbidden" | "not_found" | "request_failed"
>;

/**
 * Thrown when a Discord operation cannot be carried out.
 *
 * @remarks
 * The code is the only detail that reaches the client; messages never carry
 * credentials, state values or Discord response bodies.
 */
export class DiscordError extends Error {
  public readonly code: DiscordErrorCode;

  /** Records why an operation was refused. */
  public constructor(code: DiscordErrorCode) {
    super(code);
    this.code = code;
  }
}
