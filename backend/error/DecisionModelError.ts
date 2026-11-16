/**
 * Why a call of a decision model gave no decision, as a stable code.
 * - `decision_no_model`: no usable decision model or no usable key.
 * - `decision_key_invalid`: the provider refused the key (HTTP 401 or 403).
 * - `decision_no_credit`: the account has no credit left (HTTP 402).
 * - `decision_unsupported`: the model cannot serve the request (HTTP 400, 404 or 422).
 * - `decision_timeout`: the fixed time limit ran out.
 * - `decision_unreachable`: the provider could not be reached.
 * - `decision_failed`: any other HTTP error, such as a rate limit or a server error.
 * - `decision_invalid`: the answer is no valid decision response, or an answer
 *   is missing or has another type than asked.
 * - `decision_refused`: the model refused to answer a question.
 */
export type DecisionModelErrorCode =
  | "decision_no_model"
  | "decision_key_invalid"
  | "decision_no_credit"
  | "decision_unsupported"
  | "decision_timeout"
  | "decision_unreachable"
  | "decision_failed"
  | "decision_invalid"
  | "decision_refused";

/**
 * A call of a decision model that gave no decision.
 * @remarks
 * The message is the code alone: it never carries the key, the state, the
 * questions or the body of a provider answer. Every caller treats it as a
 * failed decision, never as "no" or as one of the options.
 */
export class DecisionModelError extends Error {
  public readonly code: DecisionModelErrorCode;

  /**
   * Creates the failure.
   * @param code - The stable reason.
   */
  public constructor(code: DecisionModelErrorCode) {
    super(code);
    this.name = "DecisionModelError";
    this.code = code;
  }
}
