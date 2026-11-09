import {
  Archive,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planAssetUrl } from "@/app/lib/plan-asset-upload";
import { planAssetTypeMark } from "@/definition/AgentPlanAsset";

import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { PlanStackEntryView, PlanStackView } from "../plan-stack-summary";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";

const KIND_ICONS = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: Archive,
  other: File,
} as const;

/** The tone of an entry by how far the run got: handed over, next, or still waiting. */
const ENTRY_TONES = {
  delivered: "border-border bg-muted text-muted-foreground",
  next: "border-plan-stack-edge bg-surface text-foreground shadow-xs",
  waiting: "border-plan-stack-edge/40 bg-surface/70 text-foreground",
} as const;

/**
 * The two diagonal strokes over an entry that was handed over.
 *
 * @remarks
 * The strokes span the whole entry from corner to corner and keep their width
 * at every size, so the mark stays clear after zooming and resizing.
 */
function DeliveredCross(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      data-plan-stack-cross=""
      className="pointer-events-none absolute inset-0 size-full text-muted-foreground"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1="0"
        x2="100"
        y2="100"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="0"
        y1="100"
        x2="100"
        y2="0"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** What an entry's second line says: when it was handed over, that it is next, or that it waits. */
function useEntryNote(view: PlanStackEntryView): string {
  const { t } = useTranslation();
  if (view.state === "next") return t("plans.stack.entry.next");
  if (view.state === "waiting") return t("plans.stack.entry.waiting");
  const iteration = view.delivery?.iteration;
  return iteration
    ? t("plans.stack.entry.deliveredIn", { number: iteration })
    : t("plans.stack.entry.delivered");
}

/** The small picture of a file entry: the image itself, else the symbol of its family. */
function EntryThumbnail(props: {
  readonly file: AgentPlanAssetFile;
}): React.ReactElement {
  const { file } = props;
  const [isBroken, setBroken] = useState(false);
  const Icon = KIND_ICONS[file.kind];
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-plan-asset-subtle text-plan-asset">
      {file.kind === "image" && !isBroken ? (
        <img
          src={planAssetUrl(file.assetId)}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon aria-hidden="true" className="size-4" />
      )}
    </span>
  );
}

/** A file entry: picture, place, name and type mark, in the states of every entry. */
function AssetEntry(props: {
  readonly view: PlanStackEntryView;
  readonly file: AgentPlanAssetFile;
}): React.ReactElement {
  const { view, file } = props;
  const note = useEntryNote(view);
  const text = `${view.position} · ${file.fileName}`;
  return (
    <li
      data-plan-stack-entry={view.entry.id}
      data-plan-stack-state={view.state}
      data-plan-stack-asset={file.kind}
      aria-label={`${text}, ${planAssetTypeMark(file)}, ${note}`}
      className={cn(
        "relative flex h-11 items-center gap-2 overflow-hidden rounded-md border px-1.5",
        ENTRY_TONES[view.state],
      )}
    >
      <EntryThumbnail file={file} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate font-semibold",
            PLAN_NODE_TEXT.field,
            view.state === "delivered" && "font-medium",
          )}
          title={text}
        >
          {text}
        </span>
        <span
          className={cn(
            "truncate",
            PLAN_NODE_TEXT.meta,
            view.state === "next" && "text-plan-stack",
            view.state === "waiting" && "text-muted-foreground",
          )}
        >
          {note}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 pr-1 font-semibold text-muted-foreground",
          PLAN_NODE_TEXT.meta,
        )}
      >
        {planAssetTypeMark(file)}
      </span>
      {view.state === "delivered" ? <DeliveredCross /> : null}
    </li>
  );
}

function StackEntry(props: {
  readonly view: PlanStackEntryView;
}): React.ReactElement {
  const { view } = props;
  const note = useEntryNote(view);
  const text = `${view.position} · ${view.label}`;
  if (view.entry.type === "asset")
    return <AssetEntry view={view} file={view.entry.file} />;
  return (
    <li
      data-plan-stack-entry={view.entry.id}
      data-plan-stack-state={view.state}
      aria-label={`${text}, ${note}`}
      className={cn(
        "relative flex h-11 flex-col justify-center overflow-hidden rounded-md border px-2.5",
        ENTRY_TONES[view.state],
      )}
    >
      <span
        className={cn(
          "truncate font-semibold",
          PLAN_NODE_TEXT.field,
          view.state === "delivered" && "font-medium",
        )}
        title={text}
      >
        {text}
      </span>
      <span
        className={cn(
          "truncate",
          PLAN_NODE_TEXT.meta,
          view.state !== "delivered" && "text-muted-foreground",
        )}
      >
        {note}
      </span>
      {view.state === "delivered" ? <DeliveredCross /> : null}
    </li>
  );
}

/**
 * The ordered entries of a stack, each with its place and how far the run got.
 *
 * @remarks
 * An entry that was handed over is greyed out completely and crossed by two
 * diagonal strokes; the next entry stands out. Handed over means the data
 * left the stack, not that the work on it succeeded.
 */
export function PlanStackEntries(props: {
  readonly view: PlanStackView;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.view.entries.length === 0)
    return (
      <p
        data-plan-stack-empty=""
        className={cn(
          "flex h-9 items-center rounded-md border border-dashed border-plan-stack-edge/50 px-2.5 text-muted-foreground",
          PLAN_NODE_TEXT.field,
        )}
      >
        {t("plans.stack.emptyHint")}
      </p>
    );
  return (
    <ol className="flex flex-col gap-1.5" aria-label={t("plans.stack.entries")}>
      {props.view.entries.map((view) => (
        <StackEntry key={view.entry.id} view={view} />
      ))}
    </ol>
  );
}
