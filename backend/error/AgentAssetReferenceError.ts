import { AgentError } from "./AgentErrors";

/** An unresolved Markdown file reference, never an authorized host file identity. */
export class AgentAssetReferenceError extends AgentError {
  public readonly fileName: string;

  public constructor(reference: string) {
    super("parameter_asset_reference_unsupported");
    this.fileName = reference.slice(0, 300);
  }
}
