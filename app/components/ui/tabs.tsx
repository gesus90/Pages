import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/app/lib/cn";

import type { ComponentProps, ReactNode } from "react";

interface TabOption {
  readonly value: string;
  readonly label: ReactNode;
}

interface TabsProps {
  readonly children?: ReactNode;
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
 * Used for compact view and filter switches.
 */
export function Tabs({
  children,
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
      className={cn("flex min-h-0 flex-col", className)}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className="inline-flex h-9 w-fit shrink-0 items-center gap-0.5 rounded-xl bg-muted/70 p-1"
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

/** Accessible panel linked to a shared Tabs trigger. */
export function TabsContent(
  properties: ComponentProps<typeof TabsPrimitive.Content>,
): React.ReactElement {
  return <TabsPrimitive.Content {...properties} tabIndex={-1} />;
}
