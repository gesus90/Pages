import { GripVertical, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
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

/** How long a finger rests on a row until its menu opens. */
const LONG_PRESS_MS = 500;

/** How far a finger may move, in pixels, before the press counts as scrolling. */
const MOVE_TOLERANCE = 10;

const MENU_ITEM_CLASS =
  "min-h-9 gap-2 rounded-lg px-2.5 text-sm data-disabled:opacity-40";

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

/** A point on the screen, in pixels of the viewport. */
interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/** The open context menu: its template and where it opened. */
interface TemplateMenuRequest {
  readonly templateId: string;
  readonly point: MenuPoint;
}

/** Where the keyboard focus goes once a deleted row left the list. */
interface FocusRequest {
  /** The row that took the place of the deleted one; `null` when none is left. */
  readonly templateId: string | null;
  /** The element that takes the focus without a row, such as the tab of the list. */
  readonly fallbackId: string | null;
}

/** The events of a row that open its context menu. */
interface RowMenuHandlers {
  onContextMenu(event: React.MouseEvent<HTMLElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onClickCapture(event: React.MouseEvent<HTMLElement>): void;
  onDragStartCapture(event: React.DragEvent<HTMLElement>): void;
}

interface RowProps extends PlanTemplateListProps {
  readonly template: AgentPlanNodeTemplate;
  readonly onMenu: (templateId: string, point: MenuPoint) => void;
}

interface RowMenuProps extends PlanTemplateListProps {
  readonly template: AgentPlanNodeTemplate;
  readonly point: MenuPoint;
  readonly onDelete: (template: AgentPlanNodeTemplate) => void;
  readonly onClose: () => void;
}

/** Stops a pending long press. */
function clearTimer(
  timer: React.RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  if (timer.current !== null) clearTimeout(timer.current);
  timer.current = null;
}

/** The row of a template in the document, found by its identifier. */
function templateRow(templateId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-plan-template="${CSS.escape(templateId)}"]`,
  );
}

/** Below the start of the row: the menu key and Shift+F10 have no pointer. */
function rowPoint(row: HTMLElement): MenuPoint {
  const box = row.getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
}

/** The tab that labels the panel of the list, which keeps the focus when no row is left. */
function listTabId(list: HTMLElement | null): string | null {
  return (
    list?.closest("[role='tabpanel']")?.getAttribute("aria-labelledby") ?? null
  );
}

/** The row after the deleted one, or the one before it at the end of the list. */
function neighbourId(
  templates: readonly AgentPlanNodeTemplate[],
  templateId: string,
): string | null {
  const index = templates.findIndex((entry) => entry.id === templateId);
  if (index < 0) return null;
  return (templates[index + 1] ?? templates[index - 1])?.id ?? null;
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
 * or could not be read; it never shows example entries. The context menu of
 * a row inserts it or deletes it; a deleted row leaves only after the server
 * confirmed the deletion, and the focus moves to the row that takes its place.
 */
export function PlanTemplateList(
  props: PlanTemplateListProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { list } = props;
  const { status, load, savedId } = list;
  const listElement = useRef<HTMLUListElement>(null);
  const [menu, setMenu] = useState<TemplateMenuRequest | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  useEffect(() => {
    if (status === "idle") load();
  }, [status, load]);
  useEffect(() => {
    if (savedId) templateRow(savedId)?.focus({ preventScroll: true });
  }, [savedId]);
  useEffect(() => {
    if (!focusRequest) return;
    // Focus that moved elsewhere during the request stays there.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const row = focusRequest.templateId
      ? templateRow(focusRequest.templateId)
      : null;
    const fallback = focusRequest.fallbackId
      ? document.getElementById(focusRequest.fallbackId)
      : null;
    (row ?? fallback)?.focus();
  }, [focusRequest]);
  function openMenu(templateId: string, point: MenuPoint): void {
    // The menu key fires its key and a context menu event; one menu opens.
    setMenu((current) =>
      current?.templateId === templateId ? current : { templateId, point },
    );
  }
  async function handleDelete(template: AgentPlanNodeTemplate): Promise<void> {
    const request = {
      templateId: neighbourId(list.templates, template.id),
      fallbackId: listTabId(listElement.current),
    };
    if (await list.remove(template)) setFocusRequest(request);
  }
  const menuTemplate = menu
    ? list.templates.find((entry) => entry.id === menu.templateId)
    : undefined;
  return (
    <>
      <TemplateListState list={list} />
      {list.templates.length > 0 ? (
        <ul
          ref={listElement}
          aria-label={t("plans.templates.list")}
          className="flex flex-col gap-1.5"
        >
          {list.templates.map((template) => (
            <li key={template.id}>
              <TemplateRow {...props} template={template} onMenu={openMenu} />
            </li>
          ))}
        </ul>
      ) : null}
      {menu && menuTemplate ? (
        <TemplateRowMenu
          key={`${menu.templateId}:${menu.point.x}:${menu.point.y}`}
          {...props}
          template={menuTemplate}
          point={menu.point}
          onDelete={(template) => void handleDelete(template)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <TemplateOutcome insertion={props.insertion} />
    </>
  );
}

/**
 * Opens the menu of a row with a right click, the menu key, Shift+F10 and a
 * long press of a finger or pen.
 * @remarks
 * The click that follows a long press inserts nothing. A finger or pen that
 * rests on a row opens its menu instead of a native drag, which would take
 * the press away; a tap still inserts and the mouse still drags.
 */
function useRowMenu(
  templateId: string,
  onMenu: (templateId: string, point: MenuPoint) => void,
): RowMenuHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<MenuPoint | null>(null);
  const hasPressed = useRef(false);
  const pressType = useRef<string | null>(null);
  function cancel(): void {
    clearTimer(timer);
  }
  function release(): void {
    pressType.current = null;
    clearTimer(timer);
  }
  useEffect(() => () => clearTimer(timer), []);
  return {
    onContextMenu: (event) => {
      event.preventDefault();
      cancel();
      // A keyboard context menu event has no pointer position.
      const hasPoint = event.clientX !== 0 || event.clientY !== 0;
      onMenu(
        templateId,
        hasPoint
          ? { x: event.clientX, y: event.clientY }
          : rowPoint(event.currentTarget),
      );
    },
    onKeyDown: (event) => {
      const isMenuKey =
        event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      if (!isMenuKey) return;
      event.preventDefault();
      onMenu(templateId, rowPoint(event.currentTarget));
    },
    onPointerDown: (event) => {
      hasPressed.current = false;
      pressType.current = event.pointerType;
      if (event.pointerType === "mouse") return;
      cancel();
      const point = { x: event.clientX, y: event.clientY };
      start.current = point;
      timer.current = setTimeout(() => {
        timer.current = null;
        hasPressed.current = true;
        onMenu(templateId, point);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (timer.current === null || origin === null) return;
      const distance = Math.hypot(
        event.clientX - origin.x,
        event.clientY - origin.y,
      );
      if (distance > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: cancel,
    onClickCapture: (event) => {
      if (!hasPressed.current) return;
      hasPressed.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStartCapture: (event) => {
      if (pressType.current === null || pressType.current === "mouse") return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/**
 * The context menu of one row at the point it opened: "Einfügen", a line and
 * "Löschen" in the destructive color.
 * @remarks
 * An invisible point of one pixel serves as the trigger, so Radix places the
 * menu there. "Löschen" stays disabled for a template of someone else and
 * while its deletion runs; the server checks the owner again. Closing returns
 * the focus to the row, unless a click outside moved it.
 */
function TemplateRowMenu(props: RowMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const { template, point, insertion } = props;
  const hasInteractedOutside = useRef(false);
  const isDeleting = props.list.deletions[template.id] === "pending";
  const canInsert =
    !props.blocked && insertion.pendingId === null && !isDeleting;
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          style={{ left: point.x, top: point.y }}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={template.name}
        containerClassName="rounded-2xl"
        className="w-50 min-w-0 p-1.5"
        collisionPadding={8}
        sideOffset={2}
        onContextMenu={(event) => event.preventDefault()}
        onInteractOutside={() => {
          hasInteractedOutside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!hasInteractedOutside.current)
            templateRow(template.id)?.focus({ preventScroll: true });
        }}
      >
        <DropdownMenuItem
          className={MENU_ITEM_CLASS}
          disabled={!canInsert}
          onSelect={() => insertion.activate(template)}
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          {t("plans.templates.menuInsert")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={cn(MENU_ITEM_CLASS, "text-destructive")}
          disabled={!template.isOwn || isDeleting}
          onSelect={() => props.onDelete(template)}
        >
          <Trash2 className="size-4 shrink-0" aria-hidden="true" />
          {t("plans.templates.menuDelete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function TemplateRow(props: RowProps): React.ReactElement {
  const { t } = useTranslation();
  const { template, insertion, blocked } = props;
  const menuHandlers = useRowMenu(template.id, props.onMenu);
  const line = templateLine(template, props.canvas, t);
  const deletion = props.list.deletions[template.id];
  const isDeleting = deletion === "pending";
  const isPending = insertion.pendingId === template.id || isDeleting;
  const isLocked =
    Boolean(blocked) || insertion.pendingId !== null || isDeleting;
  function handleClick(): void {
    if (!isDeleting) insertion.activate(template);
  }
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
      onClick={handleClick}
      {...menuHandlers}
      className={cn(
        "h-auto min-h-0 w-full min-w-0 items-start justify-start gap-2 rounded-lg px-2.5 py-2.5 text-left font-normal whitespace-normal shadow-none aria-disabled:cursor-default focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none xl:min-h-0 xl:gap-2 xl:px-2.5 xl:text-xs",
        props.list.savedId === template.id && SAVED_BORDERS[template.type],
        isDeleting && "opacity-60",
        deletion === "failed" && "border-destructive",
      )}
    >
      <TemplateRowContent
        template={template}
        line={line}
        isPending={isPending}
        isFailed={deletion === "failed"}
      />
    </PlanPaletteButton>
  );
}

/** Icon, name and second line of a row; a failed deletion takes the second line. */
function TemplateRowContent(props: {
  readonly template: AgentPlanNodeTemplate;
  readonly line: string;
  readonly isPending: boolean;
  readonly isFailed: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { template } = props;
  return (
    <>
      <PlanNodeIcon
        type={template.type}
        className={cn("mt-0.5 size-4 shrink-0", planNodeAccent(template.type))}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs leading-4.5 font-semibold">
          {template.name}
        </span>
        {props.isFailed ? (
          <span
            role="alert"
            className="truncate text-[11px] leading-4 text-destructive"
          >
            {t("plans.templates.deleteFailed")}
          </span>
        ) : (
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {props.line}
          </span>
        )}
      </span>
      {props.isPending ? (
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
    </>
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
