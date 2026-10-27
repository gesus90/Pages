import { AgentError } from "./AgentErrors";

import type { AgentErrorCode } from "./AgentErrors";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

/** Safe file identity and cause for validation and run diagnostics, without storage paths. */
export class AgentAssetError extends AgentError {
  public readonly asset: AgentTicketAsset;
  public readonly fileName: string;

  public constructor(
    code: AgentErrorCode,
    asset: AgentTicketAsset,
    fileName: string,
  ) {
    super(code);
    this.asset = asset;
    this.fileName = fileName;
  }
}
