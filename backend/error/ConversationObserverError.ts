/**
 * Why the group observer gave no result (PAGE-296), as a stable code.
 *
 * @remarks
 * The code names the cause without details of the prompt or the provider:
 * `pica_disabled`, `pica_model_missing`, `pica_access_denied`,
 * `pica_model_unavailable`, `observer_unavailable`, `observer_output_invalid`,
 * a code of the runner such as `timeout`, or a provider code such as a rate
 * limit. No failure starts an agent or a second call.
 */
export class ConversationObserverError extends Error {
  public readonly code: string;

  /**
   * Creates the failure.
   *
   * @param code - The stable reason.
   */
  public constructor(code: string) {
    super(code);
    this.name = "ConversationObserverError";
    this.code = code;
  }
}
