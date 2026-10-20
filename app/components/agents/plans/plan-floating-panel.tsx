import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/app/components/ui/button";
import { FloatingPanel } from "@/app/components/ui/card";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { cn } from "@/app/lib/cn";

import { PlanNodeIcon } from "./plan-node-icon";

import type { AgentPlanNode } from "@/definition/AgentPlan";

interface PlanFloatingPanelProps {
  /** The accessible name of the panel. */
  readonly label: string;
  /** The small line above the title, such as "Edit loop". */
  readonly kicker: string;
  readonly title: string;
  /** The node type whose symbol and color mark the panel. */
  readonly type: Extract<AgentPlanNode["type"], "loop" | "group">;
  readonly closeLabel: string;
  readonly closeButton: string;
  readonly hint: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

const ACCENTS = { loop: "text-plan-loop", group: "text-plan-group" } as const;

/** Escape closes the panel unless a control inside has used it, such as an open list. */
function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing
      )
        onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

/**
 * The floating settings panel of a container node of the plan, over the canvas.
 *
 * @remarks
 * It lies beside the node palette on wide screens and fills the width on
 * narrow ones, keeps the canvas visible and takes no backdrop. The heading
 * takes the focus when it opens; the content scrolls inside the panel and
 * the close button stays in reach. Opening, changing and closing it start
 * no run.
 */
export function PlanFloatingPanel(
  props: PlanFloatingPanelProps,
): React.ReactElement {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEscapeToClose(props.onClose);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <FloatingPanel
      role="dialog"
      aria-modal="false"
      aria-label={props.label}
      data-plan-panel={props.type}
      className="pointer-events-auto absolute inset-x-2 bottom-2 z-30 max-h-[calc(100%-1rem)] w-auto gap-0 overflow-hidden p-0 @5xl:inset-x-auto @5xl:top-4 @5xl:right-65 @5xl:bottom-4 @5xl:max-h-none @5xl:w-98"
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              ACCENTS[props.type],
            )}
          >
            <PlanNodeIcon type={props.type} className="size-3.5" />
            {props.kicker}
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="truncate text-base font-semibold outline-none"
          >
            {props.title}
          </h2>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onClose}
          aria-label={props.closeLabel}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>
      <VerticalScrollArea
        className="min-h-0 flex-1"
        viewportClassName="h-full"
        contentClassName="flex flex-col gap-4 px-5 py-4"
      >
        {props.children}
      </VerticalScrollArea>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5">
        <p className="min-w-0 text-xs text-muted-foreground">{props.hint}</p>
        <Button size="sm" onClick={props.onClose}>
          {props.closeButton}
        </Button>
      </footer>
    </FloatingPanel>
  );
}
