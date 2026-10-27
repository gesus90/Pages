import { agentAssetRepresentation } from "@/definition/AgentTicketParameter";

import type {
  AgentTicketAsset,
  AgentTicketAssetContent,
  AgentAssetOriginal,
} from "@/definition/AgentTicketParameter";
import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";

/** One metadata contract for pinned parameters and explicitly requested remote files. */
export function remoteAssetFile(
  parameter: string,
  asset: AgentTicketAsset,
  file: {
    readonly fileName: string;
    readonly content: AgentTicketAssetContent["content"];
    readonly original: AgentAssetOriginal;
  },
): PlanRemoteFile {
  const { content, original } = file;
  return {
    outcome: "input",
    parameter,
    name: file.fileName,
    type: original.mimeType,
    size: original.size,
    digest: original.digest,
    asset,
    representation: agentAssetRepresentation(content),
    modelContent: content.type === "file" ? content.reason : undefined,
    modelSize:
      content.type === "text" && content.representation === "text-extract"
        ? Buffer.byteLength(JSON.stringify(content.text))
        : undefined,
    isTruncated: content.type === "text" ? content.isTruncated : undefined,
  };
}
