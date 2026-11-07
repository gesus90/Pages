import { AgentAuthorizationError } from "./AgentAuthorizationError";

/** A Pica account is no longer allowed to act. */
export class PicaAuthorizationError extends AgentAuthorizationError {
  public constructor() {
    super("The Pica account is not authorized.");
    this.name = "PicaAuthorizationError";
  }
}
