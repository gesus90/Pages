import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "@/app/lib/cn";

import type { ComponentProps } from "react";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Renders a positioned Radix dropdown surface with Pages styling. */
export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-50 min-w-44 rounded-xl bg-surface p-1 shadow-panel outline-none",
          className,
        )}
        sideOffset={sideOffset}
        {...properties}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/** Renders a non-interactive heading inside a Radix dropdown. */
export function DropdownMenuLabel({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Label>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-3 py-2", className)}
      {...properties}
    />
  );
}

/** Renders a thin divider between groups of Radix dropdown items. */
export function DropdownMenuSeparator({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-border", className)}
      {...properties}
    />
  );
}

/** Renders one actionable Radix dropdown item with Pages styling. */
export function DropdownMenuItem({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Item>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm text-foreground outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...properties}
    />
  );
}
