import { Info } from "lucide-react";
import { useId } from "react";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";

/** A short explanation next to a label; it opens on hover, keyboard focus and tap. */
export function PanelInfo(props: {
  readonly label: string;
  readonly text: string;
}): React.ReactElement {
  return (
    <PlanPaletteButton
      variant="ghost"
      size="icon-sm"
      tooltip={props.text}
      showsOnPress
      aria-label={props.label}
      className="size-5 min-h-5 shrink-0 rounded-full p-0 text-muted-foreground xl:min-h-5 xl:p-0"
    >
      <Info className="size-3.5" aria-hidden="true" />
    </PlanPaletteButton>
  );
}

/** A labelled form row with an optional explanation. */
export function PanelField(props: {
  readonly id: string;
  readonly label: string;
  readonly info?: { readonly label: string; readonly text: string };
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-1", props.className)}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={props.id} className="text-xs font-semibold">
          {props.label}
        </label>
        {props.info ? (
          <PanelInfo label={props.info.label} text={props.info.text} />
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

/** A switch with a visible label, an optional explanation and a description. */
export function PanelSwitch(props: {
  readonly label: string;
  readonly info?: { readonly label: string; readonly text: string };
  readonly description?: string;
  readonly isChecked: boolean;
  readonly isDisabled: boolean;
  readonly onChange: (isChecked: boolean) => void;
}): React.ReactElement {
  const descriptionId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold">{props.label}</span>
          {props.info ? (
            <PanelInfo label={props.info.label} text={props.info.text} />
          ) : null}
        </div>
        {props.description ? (
          <p
            id={descriptionId}
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {props.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.isChecked}
        aria-label={props.label}
        aria-describedby={props.description ? descriptionId : undefined}
        disabled={props.isDisabled}
        onClick={() => props.onChange(!props.isChecked)}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
          props.isChecked ? "justify-end bg-primary" : "justify-start bg-muted",
        )}
      >
        <span
          aria-hidden="true"
          className="mx-0.5 size-5 rounded-full bg-white shadow"
        />
      </button>
    </div>
  );
}

/** A tinted note that explains what the current settings mean. */
export function PanelNote(props: {
  readonly children: React.ReactNode;
  readonly tone?: "neutral" | "warning";
}): React.ReactElement {
  return (
    <div
      role="note"
      className={cn(
        "rounded-lg px-3 py-2 text-xs leading-relaxed",
        props.tone === "warning"
          ? "bg-warning-subtle text-warning"
          : "bg-muted text-muted-foreground",
      )}
    >
      {props.children}
    </div>
  );
}
