import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  PLAN_FRAME_FOOTER,
  PLAN_FRAME_HEADER,
  planNodeAccent,
  PLAN_TYPE_COLORS,
} from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";
import { PLAN_NODE_TEXT } from "./plan-node-text";

// The dashed member area lies 14 px below the header and 14 px inside the
// container edge and ends where the member count line begins.
const MEMBER_AREA_GAP = 14;

/** A mark in the second header line of a container, such as its session rule. */
export const PLAN_FRAME_MARK = cn(
  "inline-flex h-[22px] max-w-56 min-w-0 shrink items-center truncate rounded-md bg-surface px-2 font-medium",
  PLAN_NODE_TEXT.meta,
);

interface PlanFrameHeaderProps {
  readonly type: "loop" | "group";
  readonly id: string;
  /** The container's name, in the type color below the type line. */
  readonly label: string;
  /** The type line above the name, with any extra sign such as a repair warning. */
  readonly typeLine: React.ReactNode;
  readonly canEdit: boolean;
  readonly onSelect: () => void;
  /** The accessible name of the handle that selects and moves the container. */
  readonly handleLabel: string;
  /** The right end of the first line: status marker, warning, edit button and menu. */
  readonly actions: React.ReactNode;
  /** The marks in the middle of the second line. */
  readonly marks: React.ReactNode;
  /** Whether the second line names the flow IN and OUT at its ends. */
  readonly hasFlowLabels: boolean;
}

/**
 * The two-line header of a loop or a group container.
 * @remarks
 * The first line holds the 30 px icon tile, the type line and the name and,
 * at the right, the status marker and the menu; the second line names the
 * flow IN and OUT at its ends and the container's marks in its middle. The
 * flow dots of a loop sit on the container edge at half the header height.
 */
export function PlanFrameHeader(
  props: PlanFrameHeaderProps,
): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header
      className={cn(
        "pointer-events-auto flex flex-col gap-1.5 rounded-t-[15px] px-3.5 py-2.5",
        PLAN_TYPE_COLORS.header,
      )}
      style={{ height: PLAN_FRAME_HEADER }}
    >
      <div className="flex h-[30px] min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-[30px] shrink-0 items-center justify-center rounded-[9px]",
            PLAN_TYPE_COLORS.tile,
          )}
        >
          <PlanNodeIcon type={props.type} className="size-4.5" />
        </span>
        <button
          type="button"
          data-plan-handle={props.id}
          onClick={props.onSelect}
          className={cn(
            "min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            props.canEdit && "cursor-grab active:cursor-grabbing",
          )}
          aria-label={props.handleLabel}
          title={props.label}
        >
          <span
            className={cn(
              "flex items-center gap-1 font-medium text-muted-foreground",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {props.typeLine}
          </span>
          <span
            className={cn(
              "block truncate",
              PLAN_NODE_TEXT.title,
              planNodeAccent(props.type),
            )}
          >
            {props.label}
          </span>
        </button>
        <div className="nodrag nopan flex shrink-0 items-center gap-1.5">
          {props.actions}
        </div>
      </div>
      <div
        className={cn(
          "flex h-5 min-w-0 items-center gap-2 text-muted-foreground",
          PLAN_NODE_TEXT.meta,
        )}
      >
        <span className="w-20 shrink-0 truncate">
          {props.hasFlowLabels ? t("plans.flowIn") : null}
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-center gap-2">
          {props.marks}
        </span>
        <span className="w-20 shrink-0 truncate text-right">
          {props.hasFlowLabels ? t("plans.flowOut") : null}
        </span>
      </div>
    </header>
  );
}

/**
 * The dashed member area of a container and the line below it.
 * @remarks
 * The area has a 1.5 px dashed edge in 40 % of the type color and a 12 px
 * corner; the members keep a 16 px inset inside it. The line 8 px below it
 * carries the member count or another short note in 11 px.
 */
export function PlanFrameMemberArea(props: {
  /** The line below the area, such as „2 interne Nodes“. */
  readonly footer: React.ReactNode;
  /** Text inside the empty area, such as how to add the first member. */
  readonly emptyText?: string;
}): React.ReactElement {
  return (
    <>
      <div
        aria-hidden="true"
        data-plan-member-area=""
        className={cn(
          "pointer-events-none absolute inset-x-3.5 rounded-xl",
          PLAN_TYPE_COLORS.memberArea,
        )}
        style={{
          top: PLAN_FRAME_HEADER + MEMBER_AREA_GAP,
          bottom: PLAN_FRAME_FOOTER,
        }}
      />
      {props.emptyText ? (
        <p
          className={cn(
            "absolute inset-x-8 text-muted-foreground",
            PLAN_NODE_TEXT.field,
          )}
          style={{ top: PLAN_FRAME_HEADER + MEMBER_AREA_GAP + 17 }}
        >
          {props.emptyText}
        </p>
      ) : null}
      <div
        className={cn(
          "pointer-events-auto absolute inset-x-3.5 bottom-3.5 flex h-4 items-center justify-center gap-4 text-muted-foreground",
          PLAN_NODE_TEXT.meta,
        )}
      >
        {props.footer}
      </div>
    </>
  );
}
