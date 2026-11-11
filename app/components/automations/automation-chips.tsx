import { cn } from "@/app/lib/cn";

import type { TriggerChip } from "./automation-labels";
import type { RunTone } from "./automation-run-summary";

/** The dot color of each run tone, from the theme tokens. */
const TONE_CLASSES: Readonly<Record<RunTone, string>> = {
  ok: "bg-success-dot",
  warning: "bg-warning",
  error: "bg-destructive",
  running: "bg-info",
  none: "bg-muted-foreground/40",
};

/** The small status dot of a run. */
export function StatusDot({
  tone,
}: {
  readonly tone: RunTone;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONE_CLASSES[tone],
      )}
    />
  );
}

/** A dot with its text, such as "vor 9 Min. · ok". */
export function StatusText({
  tone,
  text,
}: {
  readonly tone: RunTone;
  readonly text: string;
}): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <StatusDot tone={tone} />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** The chip of a trigger: events in the info tone, the rest muted. */
export function TriggerChipView({
  chip,
}: {
  readonly chip: TriggerChip;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        chip.tone === "event"
          ? "bg-info-subtle text-info"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span aria-hidden="true">{chip.glyph}</span>
      <span className="truncate">{chip.text}</span>
    </span>
  );
}
