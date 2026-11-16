/**
 * Why an agent could not generate images.
 * - `no_image_output`: the catalog does not state image output for the model
 *   the agent works with in this chat.
 * - `no_image_interface`: the model's provider has no image interface Pages
 *   reaches over the agent's connection.
 * - `no_key`: the connection holds no usable key for that interface.
 * - `provider_failed`: the provider refused the request; `detail` holds its
 *   short message without credentials.
 * - `provider_unreachable`: the provider could not be reached or the time ran out.
 * - `no_images`: the provider answered without an image; `detail` holds what
 *   the model wrote instead.
 * - `invalid_template`: a template is no image of an allowed place.
 */
export type AgentImageErrorCode =
  | "no_image_output"
  | "no_image_interface"
  | "no_key"
  | "provider_failed"
  | "provider_unreachable"
  | "no_images"
  | "invalid_template";

/** A generation of images that did not succeed, with a reason the agent passes on. */
export class AgentImageError extends Error {
  public readonly code: AgentImageErrorCode;
  /** A short readable detail, never a credential; empty without one. */
  public readonly detail: string;

  /**
   * Creates the refusal.
   * @param code - The reason.
   * @param detail - What the provider or the model said, bounded.
   */
  public constructor(code: AgentImageErrorCode, detail = "") {
    super(code);
    this.name = "AgentImageError";
    this.code = code;
    this.detail = detail;
  }
}
