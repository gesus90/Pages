import { GripVertical, LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { planNodeAccent } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import { PlanPaletteButton } from "../plan-palette-button";
import {
  planTemplateDetails,
  planTemplateError,
} from "./plan-template-summary";

import type { TFunction } from "i18next";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateType,
} from "@/definition/AgentPlanNodeTemplate";
import type { PlanCanvasProps } from "../plan-flow-context";
import type { PlanTemplateList as PlanTemplateListState } from "./use-plan-template-list";
import type {
  PlanTemplateInsertion,
  PlanTemplateOutcome,
} from "./use-plan-template-insertion";

// The template saved last keeps the border color of its node type.
const SAVED_BORDERS: Record<AgentPlanTemplateType, string> = {
  agent: "border-plan-agent/70",
  script: "border-plan-script/70",
  parameter: "border-plan-parameter/70",
  group: "border-plan-group/70",
};

interface PlanTemplateListProps {
  readonly canvas: PlanCanvasProps;
  readonly list: PlanTemplateListState;
  readonly insertion: PlanTemplateInsertion;
  readonly blocked: string | null;
}

/** The type and a short line about the configuration, as the list shows it. */
function templateLine(
  template: AgentPlanNodeTemplate,
  canvas: PlanCanvasProps,
  t: TFunction,
): string {
  return [
    t(`plans.nodeType.${template.type}`),
    ...(template.isShared ? [t("plans.templates.shared")] : []),
    ...planTemplateDetails(template.node, {
      draft: canvas.draft,
      sources: canvas.sources,
      workspaces: canvas.workspaces ?? [],
      translate: t,
    }),
  ].join(" · ");
}

/**
 * The person's saved templates, inserted by click, keyboard or drag and drop.
 *
 * @remarks
 * The list loads when it is first shown and says honestly when it is empty
 * or could not be read; it never shows example entries.
 */
export function PlanTemplateList(
  props: PlanTemplateListProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { list } = props;
  const { status, load, savedId } = list;
  useEffect(() => {
    if (status === "idle") load();
  }, [status, load]);
  useEffect(() => {
    if (savedId)
      document
        .querySelector<HTMLElement>(
          `[data-plan-template="${CSS.escape(savedId)}"]`,
        )
        ?.focus({ preventScroll: true });
  }, [savedId]);
  return (
    <>
      <TemplateListState list={list} />
      {list.templates.length > 0 ? (
        <ul
          aria-label={t("plans.templates.list")}
          className="flex flex-col gap-1.5"
        >
          {list.templates.map((template) => (
            <li key={template.id}>
              <TemplateRow {...props} template={template} />
            </li>
          ))}
        </ul>
      ) : null}
      <TemplateOutcome insertion={props.insertion} />
    </>
  );
}

function TemplateListState(props: {
  readonly list: PlanTemplateListState;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { list } = props;
  if (list.status === "failed")
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-1">
        <p className="text-xs leading-4.5 text-destructive">
          {t("plans.templates.loadFailed")}
        </p>
        <Button size="xs" variant="outline" onClick={list.load}>
          {t("plans.templates.retry")}
        </Button>
      </div>
    );
  if (list.templates.length > 0) return null;
  if (list.status === "ready")
    return (
      <p className="p-1 text-xs leading-4.5 text-muted-foreground">
        {t("plans.templates.empty")}
      </p>
    );
  return (
    <p
      role="status"
      className="flex items-center gap-2 p-1 text-xs leading-4.5 text-muted-foreground"
    >
      <LoaderCircle
        className="size-3.5 motion-safe:animate-spin"
        aria-hidden="true"
      />
      {t("plans.templates.loading")}
    </p>
  );
}

function TemplateRow(
  props: PlanTemplateListProps & { readonly template: AgentPlanNodeTemplate },
): React.ReactElement {
  const { t } = useTranslation();
  const { template, insertion, blocked } = props;
  const line = templateLine(template, props.canvas, t);
  const isPending = insertion.pendingId === template.id;
  const isLocked = Boolean(blocked) || insertion.pendingId !== null;
  return (
    <PlanPaletteButton
      variant="outline"
      tooltip={[template.name, line, t("plans.templates.hint"), blocked]
        .filter(Boolean)
        .join("\n")}
      aria-label={t("plans.templates.insert", { name: template.name })}
      aria-disabled={isLocked}
      aria-busy={isPending}
      data-plan-template={template.id}
      draggable={!isLocked}
      onDragStart={(event) => insertion.dragStart(event, template)}
      onDragEnd={insertion.dragEnd}
      onClick={() => insertion.activate(template)}
      className={cn(
        "h-auto min-h-0 w-full min-w-0 items-start justify-start gap-2 rounded-lg px-2.5 py-2.5 text-left font-normal whitespace-normal shadow-none aria-disabled:cursor-default focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none xl:min-h-0 xl:gap-2 xl:px-2.5 xl:text-xs",
        props.list.savedId === template.id && SAVED_BORDERS[template.type],
      )}
    >
      <PlanNodeIcon
        type={template.type}
        className={cn("mt-0.5 size-4 shrink-0", planNodeAccent(template.type))}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs leading-4.5 font-semibold">
          {template.name}
        </span>
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          {line}
        </span>
      </span>
      {isPending ? (
        <LoaderCircle
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
          aria-hidden="true"
        />
      ) : (
        <GripVertical
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </PlanPaletteButton>
  );
}

function outcomeText(t: TFunction, outcome: PlanTemplateOutcome): string {
  if (outcome.kind === "failed")
    return t("plans.templates.insertFailed", {
      name: outcome.name,
      reason: planTemplateError(t, outcome.error),
    });
  const inserted = t("plans.templates.inserted", { name: outcome.name });
  if (outcome.openInputs.length === 0) return inserted;
  return `${inserted} ${t("plans.templates.openInputs", {
    inputs: outcome.openInputs.join(", "),
  })}`;
}

function TemplateOutcome(props: {
  readonly insertion: PlanTemplateInsertion;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { outcome } = props.insertion;
  if (!outcome) return null;
  const isFailure = outcome.kind === "failed";
  return (
    <div
      role={isFailure ? "alert" : "status"}
      className={cn(
        "mt-1 flex items-start gap-1 rounded-md border p-1.5 pl-2 text-[11px] leading-4",
        isFailure
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground",
      )}
    >
      <p className="min-w-0 flex-1 wrap-anywhere">{outcomeText(t, outcome)}</p>
      <button
        type="button"
        aria-label={t("plans.templates.dismiss")}
        onClick={props.insertion.dismiss}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}
