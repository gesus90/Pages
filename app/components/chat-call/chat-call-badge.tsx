import { cn } from "@/app/lib/cn";

interface ChatCallBadgeProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

/** The small mark "Prototyp" or "Anruf" of the simulated call. */
export function ChatCallBadge({
  children,
  className,
}: ChatCallBadgeProps): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] border border-border bg-surface px-2 text-[11px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
