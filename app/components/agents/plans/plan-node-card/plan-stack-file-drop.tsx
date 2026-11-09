import { TriangleAlert, Upload } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { addPlanStackAsset } from "@/definition/AgentPlanStackEdit";
import { PLAN_STACK_ENTRY_COUNT } from "@/definition/AgentPlanStack";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { usePlanAssetUpload } from "./use-plan-asset-upload";

import type { AgentPlanStack } from "@/definition/AgentPlanStack";

/**
 * Files dropped onto a stack become its last entries, without an asset node each (PAGE-268).
 *
 * @returns The drop handlers for the whole card and the row that offers the choice.
 */
export function usePlanStackFileDrop(stack: AgentPlanStack): {
  readonly handlers: Pick<
    React.HTMLAttributes<HTMLDivElement>,
    "onDragOver" | "onDragLeave" | "onDrop"
  >;
  readonly row: React.ReactElement | null;
} {
  const { graph } = usePlanFlowContext();
  const upload = usePlanAssetUpload((file) =>
    graph.edit((draft) =>
      addPlanStackAsset(draft, stack.id, { id: createRandomUuid(), file }),
    ),
  );
  const isFull = stack.entries.length >= PLAN_STACK_ENTRY_COUNT;
  return {
    handlers: isFull
      ? {}
      : {
          onDragOver: upload.dragOver,
          onDragLeave: upload.dragLeave,
          onDrop: upload.drop,
        },
    row: upload.isEnabled && !isFull ? <StackFileRow upload={upload} /> : null,
  };
}

function StackFileRow(props: {
  readonly upload: ReturnType<typeof usePlanAssetUpload>;
}): React.ReactElement {
  const { t } = useTranslation();
  const inputId = useId();
  const { state } = props.upload;
  let text = t("plans.asset.stackDrop");
  if (state.kind === "dragging") text = t("plans.asset.dropHere");
  if (state.kind === "uploading")
    text = t("plans.asset.uploadingShare", {
      name: state.fileName,
      percent: Math.round(state.share * 100),
    });
  if (state.kind === "failed")
    text = t(`settings.agents.error.${state.code}`, {
      defaultValue: t("plans.asset.uploadFailed"),
    });
  const Icon = state.kind === "failed" ? TriangleAlert : Upload;
  return (
    <>
      <label
        htmlFor={inputId}
        data-plan-stack-files={state.kind}
        className={cn(
          "nodrag flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-2 font-medium",
          PLAN_NODE_TEXT.field,
          state.kind === "failed"
            ? "border-destructive text-destructive"
            : "border-plan-stack-edge/60 text-plan-stack",
          state.kind === "dragging" && "bg-plan-stack/10",
        )}
        role={state.kind === "uploading" ? "status" : undefined}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{text}</span>
      </label>
      <input
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          void props.upload.upload([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
