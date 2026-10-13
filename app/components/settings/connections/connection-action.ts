/** Owner-scoped mutation shown in a confirmation dialog before it is submitted. */
export interface ConnectionAction {
  readonly intent: "revoke-token" | "request-rotation";
  readonly id?: string;
  readonly name?: string;
}
