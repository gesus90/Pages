import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PlanPaletteTab, PlanPaletteView } from "./use-plan-palette-view";

const TABS: readonly PlanPaletteTab[] = ["nodes", "templates"];

/**
 * The two labelled tabs of the palette, Nodes and Templates.
 *
 * @remarks
 * Arrow keys, Home and End move between the tabs and show the focused one,
 * as for a tab list with automatic activation.
 */
export function PlanPaletteTabs(props: {
  readonly view: PlanPaletteView;
  /** The prefix of the tab and panel identifiers. */
  readonly baseId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { view, baseId } = props;
  function keyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const index = TABS.indexOf(view.tab);
    const targets: Partial<Record<string, number>> = {
      ArrowLeft: (index + TABS.length - 1) % TABS.length,
      ArrowRight: (index + 1) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const next = targets[event.key];
    const tab = next === undefined ? undefined : TABS[next];
    if (!tab) return;
    event.preventDefault();
    view.select(tab);
    document.getElementById(`${baseId}-${tab}`)?.focus({ preventScroll: true });
  }
  return (
    <div
      role="tablist"
      aria-label={t("plans.palette.tabs")}
      className="grid min-w-0 flex-1 grid-cols-2 gap-1"
    >
      {TABS.map((tab) => {
        const isSelected = view.tab === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${baseId}-${tab}`}
            aria-selected={isSelected}
            aria-controls={`${baseId}-panel`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => view.select(tab)}
            onKeyDown={keyDown}
            className={cn(
              "h-8 min-w-0 truncate rounded-md px-2 text-xs leading-4.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none [@media(pointer:coarse)]:h-11",
              isSelected && "bg-muted text-foreground",
            )}
          >
            {t(`plans.palette.tab.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}
