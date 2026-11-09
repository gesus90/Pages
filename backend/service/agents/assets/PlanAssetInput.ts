import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type {
  AgentTicketAsset,
  AgentTicketInput,
} from "@/definition/AgentTicketParameter";

const KIND_LABELS = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  archive: "archive",
  other: "file",
} as const;

/** The stable address of a plan asset; it names the file, it grants nothing. */
export function planAssetLink(assetId: string): string {
  return `/agent-plan-assets/${assetId}`;
}

/** The reference the asset handover reads with the executor's rights. */
export function planAssetReference(assetId: string): AgentTicketAsset {
  return { source: "plan", id: assetId, link: planAssetLink(assetId) };
}

/**
 * The text a placeholder of an asset parameter stands for.
 *
 * @remarks
 * Names the file, its detected type and size. The file itself follows the
 * prompt as an attachment with its path; the text never claims the agent
 * can open every type.
 */
export function planAssetPromptText(file: AgentPlanAssetFile): string {
  return `${file.fileName} (${KIND_LABELS[file.kind]}, ${file.mediaType}, ${file.size} bytes; the file is attached to this assignment)`;
}

/**
 * The file handover of an asset parameter, through the established ticket asset path.
 *
 * @remarks
 * The digest the plan chose is pinned: a file whose content changed since
 * then is refused at the handover instead of being sent in its new form.
 */
export function planAssetInput(
  parameter: string,
  file: AgentPlanAssetFile,
): AgentTicketInput {
  return {
    parameter,
    owner: "asset",
    originals: { [`plan:${file.assetId}`]: file.digest },
    ticket: {
      id: file.assetId,
      key: file.fileName,
      title: file.fileName,
      description: "",
      markdown: "",
      version: file.digest,
      assets: [planAssetReference(file.assetId)],
    },
  };
}
