/** Owner-scoped mutation shown in a confirmation dialog before it is submitted. */
export interface ConnectionAction {
  readonly intent:
    | "revoke-token"
    | "request-rotation"
    | "revoke-oauth-grant"
    | "set-oauth-duration";
  readonly id?: string;
  readonly name?: string;
  readonly duration?: string;
  readonly count?: number;
}
