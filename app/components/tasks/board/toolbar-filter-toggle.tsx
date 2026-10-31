import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { ComponentProps } from "react";

interface ToolbarFilterToggleProps extends ComponentProps<"button"> {
  /** How many filters narrow the board down; the panel hides them when collapsed. */
  readonly activeCount: number;
}

/** Renders the trigger for the filter panel. */
export function ToolbarFilterToggle({
  activeCount,
  ...properties
}: ToolbarFilterToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Button
      className="group gap-2 data-[state=open]:text-primary-text"
      size="sm"
      type="button"
      variant="outline"
      {...properties}
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
        className="size-4 transition-transform group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </Button>
  );
}
