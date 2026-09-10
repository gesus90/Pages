import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface TabOption {
  readonly value: string;
  readonly label: ReactNode;
}

interface TabsProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly tabs: readonly TabOption[];
  readonly ariaLabel?: string;
  readonly className?: string;
}

/**
 * Renders a segmented tab control built on Radix Tabs.
 *
 * @remarks
 * Verwendet für kompakte Ansichts- und Filterumschalter sowie
 * für Inhalts-Tabs mit eigenem Content über `TabsContent`.
 */
export function Tabs({
  value,
  onValueChange,
  tabs,
  ariaLabel,
  className,
}: TabsProps): React.ReactElement {
  function handleValueChange(nextValue: string): void {
    onValueChange(nextValue);
  }

  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={handleValueChange}
      className={cn(
        "flex items-center gap-1 rounded-xl bg-muted/60 p-1",
        className,
      )}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className="flex w-full flex-wrap items-center gap-1"
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:bg-primary-subtle data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export const TabsContent = TabsPrimitive.Content;
