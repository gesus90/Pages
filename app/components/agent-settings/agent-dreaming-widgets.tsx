import { cn } from "@/app/lib/cn";

/** How a badge is colored: by the meaning of its word, with semantic tokens. */
export type DreamBadgeTone =
  "neutral" | "success" | "warning" | "destructive" | "info";

const BADGE_TONES: Readonly<Record<DreamBadgeTone, string>> = {
  neutral: "border-border bg-surface text-muted-foreground",
  success: "border-success/30 bg-success-subtle text-success",
  warning: "border-warning/30 bg-warning-subtle text-warning",
  destructive: "border-destructive/30 bg-destructive-subtle text-destructive",
  info: "border-info/30 bg-info-subtle text-info",
};

/**
 * A small pill with a word, such as the result of a run or the status of a
 * recipe.
 */
export function DreamBadge({
  tone = "neutral",
  children,
}: {
  readonly tone?: DreamBadgeTone;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A card with a title, the container of every block of the tabs of Dreaming and lessons. */
export function DreamCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  /** A control right of the title, such as a button. */
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
