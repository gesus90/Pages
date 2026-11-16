/**
 * Why an agent could not generate a video or a sound.
 * - `no_media_output`: the catalog does not state video or audio output for
 *   the model the agent works with in this chat.
 * - `no_media_interface`: the model's provider has no documented interface
 *   for the kind that Pages reaches over the agent's connection.
 * - `no_key`: the connection holds no usable key for that interface.
 * - `provider_failed`: the provider refused the request; `detail` holds its
 *   short message without credentials.
 * - `provider_unreachable`: the provider could not be reached or the time ran out.
 * - `no_media`: the provider answered without a video or a sound; `detail`
 *   holds what the model wrote instead.
 */
export type AgentMediaErrorCode =
  | "no_media_output"
  | "no_media_interface"
  | "no_key"
  | "provider_failed"
  | "provider_unreachable"
  | "no_media";

/** A generation of a video or a sound that did not succeed, with a reason the agent passes on. */
export class AgentMediaError extends Error {
  public readonly code: AgentMediaErrorCode;
  /** A short readable detail, never a credential; empty without one. */
  public readonly detail: string;

  /**
   * Creates the refusal.
   * @param code - The reason.
   * @param detail - What the provider or the model said, bounded.
   */
  public constructor(code: AgentMediaErrorCode, detail = "") {
    super(code);
    this.name = "AgentMediaError";
    this.code = code;
    this.detail = detail;
  }
}
