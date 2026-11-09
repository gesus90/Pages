import { File, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { checkPlanAsset } from "@/app/lib/plan-asset-upload";

import { PLAN_NODE_TEXT } from "../plan-node-text";
import { formatPlanAssetSize } from "./plan-asset-format";
import {
  PlanAssetAudio,
  PlanAssetDocument,
  PlanAssetImage,
  PlanAssetVideo,
} from "./plan-asset-media";

import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { PlanAssetFacts } from "./plan-asset-format";
import type { PlanAssetMediaProps } from "./plan-asset-media";
import type { PlanAssetUploadState } from "./use-plan-asset-upload";

/** Whether the person may still read the file: checked, failed, or still asked. */
export type PlanAssetAccess =
  "checking" | "readable" | "unreadable" | "missing" | "changed";

const PREVIEWS = {
  image: PlanAssetImage,
  video: PlanAssetVideo,
  audio: PlanAssetAudio,
  document: PlanAssetDocument,
} as const;

/**
 * Asks once per file whether it can still be read, and keeps a failure the preview itself found.
 *
 * @returns The access and a way for the preview to report that it could not load.
 */
export function usePlanAssetAccess(file: AgentPlanAssetFile | null): {
  readonly access: PlanAssetAccess;
  readonly fail: () => void;
} {
  const [access, setAccess] = useState<PlanAssetAccess>("checking");
  const assetId = file?.assetId ?? "";
  const digest = file?.digest ?? "";
  useEffect(() => {
    if (!assetId) return undefined;
    const controller = new AbortController();
    setAccess("checking");
    checkPlanAsset({ assetId, digest }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAccess(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccess("missing");
      });
    return () => controller.abort();
  }, [assetId, digest]);
  return { access, fail: () => setAccess("unreadable") };
}

/** The frame every state of the preview shares. */
function PreviewFrame(props: {
  readonly tone: "plain" | "drop" | "error";
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-plan-asset-preview={props.tone}
      className={cn(
        "relative flex h-[7.5rem] w-full items-center justify-center overflow-hidden rounded-lg border",
        props.tone === "plain" && "border-border bg-surface",
        props.tone === "drop" &&
          "border-2 border-dashed border-primary bg-primary/5 text-primary",
        props.tone === "error" &&
          "border-destructive bg-surface text-destructive",
      )}
    >
      {props.children}
    </div>
  );
}

function Notice(props: {
  readonly icon: typeof File;
  readonly text: string;
  readonly tone?: "muted" | "strong";
}): React.ReactElement {
  const Icon = props.icon;
  return (
    <div className="flex flex-col items-center gap-2 px-3 text-center">
      <Icon aria-hidden="true" className="size-6" />
      <span
        className={cn(
          PLAN_NODE_TEXT.meta,
          props.tone === "strong" ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {props.text}
      </span>
    </div>
  );
}

/** Upload progress: share, bytes sent and the size. */
function UploadProgress(props: {
  readonly state: Extract<PlanAssetUploadState, { kind: "uploading" }>;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { state } = props;
  const percent = Math.round(state.share * 100);
  return (
    <div className="flex w-full flex-col items-center gap-2 px-4" role="status">
      <span className={cn("font-semibold", PLAN_NODE_TEXT.field)}>
        {percent} %
      </span>
      <progress
        className="h-1.5 w-full accent-plan-asset"
        max={100}
        value={percent}
        aria-label={t("plans.asset.uploading", { name: state.fileName })}
      />
      <span className={cn("text-muted-foreground", PLAN_NODE_TEXT.meta)}>
        {t("plans.asset.uploaded", {
          sent: formatPlanAssetSize(state.size * state.share, i18n.language),
          size: formatPlanAssetSize(state.size, i18n.language),
        })}
      </span>
    </div>
  );
}

/**
 * The small preview of an asset card in all its states.
 *
 * @remarks
 * Drop target, upload with progress, a refused upload, a file nobody may read
 * any more (red frame), the preview of its family, or a fallback with no
 * preview. Nothing in it runs: media start only on a click.
 */
export function PlanAssetPreview(props: {
  readonly file: AgentPlanAssetFile | null;
  readonly upload: PlanAssetUploadState;
  readonly access: PlanAssetAccess;
  readonly onFacts: (facts: PlanAssetFacts) => void;
  readonly onFailure: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { file, upload, access } = props;
  if (upload.kind === "dragging")
    return (
      <PreviewFrame tone="drop">
        <Notice icon={Upload} text={t("plans.asset.dropHere")} tone="strong" />
      </PreviewFrame>
    );
  if (upload.kind === "uploading")
    return (
      <PreviewFrame tone="plain">
        <UploadProgress state={upload} />
      </PreviewFrame>
    );
  if (upload.kind === "failed")
    return (
      <PreviewFrame tone="error">
        <Notice
          icon={TriangleAlert}
          text={t(`settings.agents.error.${upload.code}`, {
            defaultValue: t("plans.asset.uploadFailed"),
          })}
          tone="strong"
        />
      </PreviewFrame>
    );
  if (!file)
    return (
      <PreviewFrame tone="drop">
        <Notice
          icon={Upload}
          text={t("plans.asset.dropOrChoose")}
          tone="strong"
        />
      </PreviewFrame>
    );
  return <FilePreview {...props} file={file} access={access} />;
}

function FilePreview(props: {
  readonly file: AgentPlanAssetFile;
  readonly access: PlanAssetAccess;
  readonly onFacts: PlanAssetMediaProps["onFacts"];
  readonly onFailure: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { file, access } = props;
  if (access === "missing" || access === "unreadable" || access === "changed")
    return (
      <PreviewFrame tone="error">
        <Notice
          icon={TriangleAlert}
          text={t(`plans.asset.access.${access}`)}
          tone="strong"
        />
      </PreviewFrame>
    );
  const kind = file.kind;
  if (kind === "archive" || kind === "other" || access === "checking")
    return (
      <PreviewFrame tone="plain">
        <Notice
          icon={File}
          text={
            access === "checking"
              ? t("plans.asset.checking")
              : t("plans.asset.noPreview")
          }
        />
      </PreviewFrame>
    );
  const Preview = PREVIEWS[kind];
  return (
    <PreviewFrame tone="plain">
      <Preview
        file={file}
        onFacts={props.onFacts}
        onFailure={props.onFailure}
      />
    </PreviewFrame>
  );
}
