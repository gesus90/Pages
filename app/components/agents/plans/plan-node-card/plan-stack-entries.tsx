import {
  Archive,
  Check,
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
  delivered: "text-muted-foreground",
  next: "text-foreground ring-1 ring-plan-stack/50",
  waiting: "text-foreground",
} as const;

/** One entry: a 28 px muted row with a 6 px corner. */
const ENTRY_CLASS =
  "relative flex h-7 min-w-0 items-center gap-2 rounded-md bg-muted pr-2 pl-1";

/** The place of an entry in an 18 px tile. */
function EntryNumber(props: { readonly position: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded bg-surface font-semibold text-muted-foreground tabular-nums",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {props.position}
    </span>
  );
}

/** The check of an entry that was handed over, in the success color. */
function DeliveredCheck(): React.ReactElement {
  return (
    <Check
      aria-hidden="true"
      data-plan-stack-delivered=""
      className="ml-auto size-3.5 shrink-0 text-success"
    />
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
    <span className="flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded bg-plan-asset-subtle text-plan-asset">
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
        <Icon aria-hidden="true" className="size-3" />
      )}
    </span>
  );
}

/** A file entry: place, picture, name and type mark, in the states of every entry. */
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
      title={`${text} · ${note}`}
      className={cn(ENTRY_CLASS, ENTRY_TONES[view.state])}
    >
      <EntryNumber position={view.position} />
      <EntryThumbnail file={file} />
      <span className={cn("min-w-0 flex-1 truncate", PLAN_NODE_TEXT.field)}>
        {file.fileName}
      </span>
      <span
        className={cn(
          "shrink-0 font-semibold text-muted-foreground",
          PLAN_NODE_TEXT.meta,
        )}
      >
        {planAssetTypeMark(file)}
      </span>
      {view.state === "delivered" ? <DeliveredCheck /> : null}
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
      title={`${text} · ${note}`}
      className={cn(ENTRY_CLASS, ENTRY_TONES[view.state])}
    >
      <EntryNumber position={view.position} />
      <span className={cn("min-w-0 flex-1 truncate", PLAN_NODE_TEXT.field)}>
        {view.label}
      </span>
      {view.state === "delivered" ? <DeliveredCheck /> : null}
    </li>
  );
}

/**
 * The ordered entries of a stack, each with its place and how far the run got.
 *
 * @remarks
 * Every entry is a 28 px row with its place in an 18 px tile. An entry that
 * was handed over is greyed out and checked in the success color; the next
 * entry stands out. Handed over means the data left the stack, not that the
 * work on it succeeded.
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
          "flex h-7 items-center rounded-md bg-muted px-2 text-muted-foreground",
          PLAN_NODE_TEXT.field,
        )}
      >
        {t("plans.stack.emptyHint")}
      </p>
    );
  return (
    <ol className="flex flex-col gap-1" aria-label={t("plans.stack.entries")}>
      {props.view.entries.map((view) => (
        <StackEntry key={view.entry.id} view={view} />
      ))}
    </ol>
  );
}
