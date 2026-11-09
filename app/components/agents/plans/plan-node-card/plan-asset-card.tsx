import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planAssetTypeMark } from "@/definition/AgentPlanAsset";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanCard } from "./plan-card";
import { PlanValueOut } from "./plan-value-out";
import { planAssetMeta } from "./plan-asset-format";
import { PlanAssetPreview, usePlanAssetAccess } from "./plan-asset-preview";
import { usePlanAssetUpload } from "./use-plan-asset-upload";

import type {
  AgentPlanAsset,
  AgentPlanAssetFile,
} from "@/definition/AgentPlanAsset";
import type { PlanAssetFacts } from "./plan-asset-format";
import type { PlanAssetAccess } from "./plan-asset-preview";

/** The title a node takes from its first file while it still carries the default name. */
function titleFor(
  node: AgentPlanAsset,
  file: AgentPlanAssetFile,
  defaultName: string,
): string {
  if (node.name.trim() && node.name !== defaultName) return node.name;
  return file.fileName.replace(/\.[^.]+$/u, "").slice(0, 120) || defaultName;
}

/** The file name with its type mark, the meta line, or the choice of a file. */
function AssetDetails(props: {
  readonly node: AgentPlanAsset;
  readonly facts: PlanAssetFacts;
  readonly access: PlanAssetAccess;
  readonly inputId: string;
  readonly canChoose: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { file } = props.node;
  if (!file)
    return (
      <p className={cn("text-muted-foreground", PLAN_NODE_TEXT.meta)}>
        {t("plans.asset.or")}{" "}
        <label
          htmlFor={props.inputId}
          className={cn(
            "nodrag underline underline-offset-2",
            props.canChoose ? "cursor-pointer text-foreground" : "opacity-60",
          )}
        >
          {t("plans.asset.choose")}
        </label>
      </p>
    );
  const isBroken =
    props.access === "missing" ||
    props.access === "unreadable" ||
    props.access === "changed";
  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span
          className={cn("truncate font-semibold", PLAN_NODE_TEXT.field)}
          title={file.fileName}
        >
          {file.fileName}
        </span>
        <span
          className={cn(
            "shrink-0 rounded bg-surface/80 px-1 font-semibold text-muted-foreground",
            PLAN_NODE_TEXT.meta,
          )}
        >
          {planAssetTypeMark(file)}
        </span>
      </div>
      <p
        className={cn(
          "truncate",
          PLAN_NODE_TEXT.meta,
          isBroken ? "text-destructive" : "text-muted-foreground",
        )}
        title={file.mediaType}
      >
        {isBroken
          ? t("plans.asset.blocksRun")
          : planAssetMeta(file, props.facts, {
              translate: t,
              language: i18n.language,
            })}
      </p>
    </>
  );
}

/**
 * The Asset node (PAGE-268): one file the plan hands to the inputs it feeds.
 *
 * @remarks
 * A file is dropped onto the card or chosen; the server detects its type from
 * the content. The card shows a small preview fitting the family, a fallback
 * for files it cannot show, upload progress, and a red frame when the file can
 * no longer be read: such a node refuses the start of a run.
 */
export function PlanAssetCard(props: {
  readonly node: AgentPlanAsset;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = usePlanFlowContext();
  const { node } = props;
  const inputId = useId();
  const [facts, setFacts] = useState<PlanAssetFacts>({});
  const addFacts = useCallback(
    (found: PlanAssetFacts) =>
      setFacts((current) => ({ ...current, ...found })),
    [],
  );
  const { access, fail } = usePlanAssetAccess(node.file);
  const defaultName = t("plans.asset.defaultName");
  const upload = usePlanAssetUpload((file) => {
    setFacts({});
    graph.replaceNode({
      ...node,
      name: titleFor(node, file, defaultName),
      file,
    });
  });
  const isBroken =
    node.file !== null &&
    (access === "missing" || access === "unreadable" || access === "changed");
  const label = node.name.trim() || defaultName;
  return (
    <div
      data-plan-asset={node.id}
      data-plan-asset-kind={node.file?.kind ?? "empty"}
      data-plan-asset-access={node.file ? access : "empty"}
      className="w-full min-w-0 rounded-xl"
      onDragOver={upload.dragOver}
      onDragLeave={upload.dragLeave}
      onDrop={upload.drop}
    >
      <PlanCard
        node={node}
        label={label}
        title={label}
        subtitle={t("plans.asset.caption")}
        runClass={
          isBroken ? "border-destructive bg-plan-asset-subtle" : undefined
        }
      >
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <PlanAssetPreview
            file={node.file}
            upload={upload.state}
            access={access}
            onFacts={addFacts}
            onFailure={fail}
          />
          <input
            id={inputId}
            type="file"
            className="sr-only"
            disabled={!upload.isEnabled}
            aria-label={t("plans.asset.choose")}
            onChange={(event) => {
              void upload.upload(
                [...(event.currentTarget.files ?? [])].slice(0, 1),
              );
              event.currentTarget.value = "";
            }}
          />
          <AssetDetails
            node={node}
            facts={facts}
            access={access}
            inputId={inputId}
            canChoose={upload.isEnabled}
          />
          <div className="relative flex h-7 items-center justify-end">
            <span className={cn("font-medium", PLAN_NODE_TEXT.field)}>
              {t("plans.asset.dataOut")}
            </span>
            <PlanValueOut nodeId={node.id} labelKey="plans.asset.dataOut" />
          </div>
        </div>
      </PlanCard>
    </div>
  );
}
