import { useState } from "react";

import {
  PlanAssetUploadError,
  uploadPlanAsset,
} from "@/app/lib/plan-asset-upload";

import { usePlanFlowContext } from "../plan-flow-context";

import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";

/** Where an upload stands: none, a file dragged over, sending, or refused. */
export type PlanAssetUploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "dragging" }
  | {
      readonly kind: "uploading";
      readonly fileName: string;
      readonly size: number;
      readonly share: number;
    }
  | {
      readonly kind: "failed";
      readonly fileName: string;
      readonly code: string;
    };

/** The project of the plan a file belongs to: the workspace's project, else the saved one. */
function useProjectId(): string {
  const { draft, workspaces } = usePlanFlowContext();
  return (
    workspaces?.find((workspace) => workspace.id === draft.workspaceId)
      ?.projectId ??
    draft.projectId ??
    ""
  );
}

/**
 * Drag and drop and file choice for asset nodes and stacks, with progress.
 *
 * @param onUploaded - Receives each stored file, in the order chosen.
 * @returns The state and the handlers of a drop zone and a file input.
 */
export function usePlanAssetUpload(
  onUploaded: (file: AgentPlanAssetFile) => void,
): {
  readonly state: PlanAssetUploadState;
  readonly isEnabled: boolean;
  readonly upload: (files: readonly File[]) => Promise<void>;
  readonly dragOver: (event: React.DragEvent) => void;
  readonly dragLeave: () => void;
  readonly drop: (event: React.DragEvent) => void;
} {
  const { canEdit } = usePlanFlowContext();
  const projectId = useProjectId();
  const [state, setState] = useState<PlanAssetUploadState>({ kind: "idle" });
  const isEnabled = canEdit && projectId !== "";
  async function upload(files: readonly File[]): Promise<void> {
    if (!isEnabled) return;
    for (const file of files) {
      setState({
        kind: "uploading",
        fileName: file.name,
        size: file.size,
        share: 0,
      });
      try {
        const stored = await uploadPlanAsset(projectId, file, (share) =>
          setState({
            kind: "uploading",
            fileName: file.name,
            size: file.size,
            share,
          }),
        );
        onUploaded(stored);
      } catch (error: unknown) {
        setState({
          kind: "failed",
          fileName: file.name,
          code: error instanceof PlanAssetUploadError ? error.code : "network",
        });
        return;
      }
    }
    setState({ kind: "idle" });
  }
  function hasFiles(event: React.DragEvent): boolean {
    return event.dataTransfer.types.includes("Files");
  }
  function dragOver(event: React.DragEvent): void {
    if (!isEnabled || !hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (state.kind !== "dragging" && state.kind !== "uploading")
      setState({ kind: "dragging" });
  }
  function dragLeave(): void {
    if (state.kind === "dragging") setState({ kind: "idle" });
  }
  function drop(event: React.DragEvent): void {
    if (!isEnabled || !hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    void upload([...event.dataTransfer.files]);
  }
  return { state, isEnabled, upload, dragOver, dragLeave, drop };
}
