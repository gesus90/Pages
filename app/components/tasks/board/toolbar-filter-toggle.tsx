import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

interface ToolbarFilterToggleProps {
  readonly isOpen: boolean;
  /** How many filters narrow the board down; the panel hides them when collapsed. */
  readonly activeCount: number;
  readonly onToggle: () => void;
}

/** Renders the phone-only button that folds the filters and the sort options in and out. */
export function ToolbarFilterToggle({
  isOpen,
  activeCount,
  onToggle,
}: ToolbarFilterToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Button
      aria-expanded={isOpen}
      className="gap-2 md:hidden"
      onClick={onToggle}
      size="sm"
      type="button"
      variant="outline"
    >
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {t("tasks.filter.toggle")}
      {activeCount > 0 ? (
        <span
          aria-label={t("tasks.filter.activeCount", { count: activeCount })}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
        >
          {activeCount}
        </span>
      ) : null}
      <ChevronDown
        className={cn("size-4 transition-transform", isOpen && "rotate-180")}
        aria-hidden="true"
      />
    </Button>
  );
}
